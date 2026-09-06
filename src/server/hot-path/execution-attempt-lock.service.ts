import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

type ExecutionAttemptRecord = {
  candidateId: string;
  executionId: string;
  claimedAt: string;
};

const attempts = new Map<string, ExecutionAttemptRecord>();
const DURABLE_ATTEMPT_PREFIX = "execution.attempt.lock";

function normalizeCandidateId(candidateId: string) {
  return candidateId.trim().toUpperCase();
}

function buildDurableAttemptKey(input: {
  userId: string;
  executionMode?: string | null;
  venue?: string | null;
  candidateId: string;
}) {
  const mode = String(input.executionMode ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const venue = String(input.venue ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  return `${DURABLE_ATTEMPT_PREFIX}.${input.userId}.${mode}.${venue}.${normalizeCandidateId(input.candidateId)}`;
}

export function claimCanonicalExecutionAttempt(input: {
  candidateId: string;
  executionId: string;
}): { ok: true } | { ok: false; reason: string; existingExecutionId: string } {
  const key = normalizeCandidateId(input.candidateId);
  const existing = attempts.get(key);
  if (existing) {
    return {
      ok: false,
      reason: "DUPLICATE_EXECUTION_PATH",
      existingExecutionId: existing.executionId,
    };
  }
  attempts.set(key, {
    candidateId: key,
    executionId: input.executionId,
    claimedAt: new Date().toISOString(),
  });
  return { ok: true };
}

export function getCanonicalExecutionAttempt(candidateId: string): ExecutionAttemptRecord | null {
  return attempts.get(normalizeCandidateId(candidateId)) ?? null;
}

export function releaseCanonicalExecutionAttempt(candidateId: string): void {
  attempts.delete(normalizeCandidateId(candidateId));
}

export function resetCanonicalExecutionAttemptsForTests(): void {
  attempts.clear();
}

export async function claimDurableCanonicalExecutionAttempt(input: {
  userId: string;
  candidateId: string;
  executionId: string;
  decisionId?: string | null;
  executionMode?: string | null;
  venue?: string | null;
  leaseMs?: number;
}): Promise<{ ok: true; key: string } | { ok: false; reason: string; existingExecutionId: string; key: string }> {
  const candidateId = normalizeCandidateId(input.candidateId);
  const key = buildDurableAttemptKey({
    userId: input.userId,
    executionMode: input.executionMode,
    venue: input.venue,
    candidateId,
  });
  const now = Date.now();
  const leaseMs = Math.max(15_000, input.leaseMs ?? 180_000);
  const value = {
    candidateId,
    executionId: input.executionId,
    decisionId: input.decisionId ?? null,
    executionMode: input.executionMode ?? null,
    venue: input.venue ?? null,
    executionState: "IN_PROGRESS",
    claimedAt: new Date(now).toISOString(),
    leaseExpiresAt: new Date(now + leaseMs).toISOString(),
  } as Prisma.InputJsonValue;
  try {
    await prisma.appSetting.create({
      data: {
        key,
        scope: "USER",
        userId: input.userId,
        value,
        valueType: "json",
        status: "ACTIVE",
        description: "Durable canonical execution attempt lock",
      },
    });
    return { ok: true, key };
  } catch {
    const existing = await prisma.appSetting.findUnique({ where: { key } });
    const payload = (existing?.value as Record<string, unknown> | null) ?? null;
    const existingExecutionId =
      payload && typeof payload.executionId === "string" && payload.executionId.trim().length > 0
        ? payload.executionId
        : input.executionId;
    return {
      ok: false,
      reason: "DUPLICATE_EXECUTION_PATH",
      existingExecutionId,
      key,
    };
  }
}

export async function releaseDurableCanonicalExecutionAttempt(input: {
  userId: string;
  candidateId: string;
  executionMode?: string | null;
  venue?: string | null;
}): Promise<void> {
  const key = buildDurableAttemptKey({
    userId: input.userId,
    executionMode: input.executionMode,
    venue: input.venue,
    candidateId: input.candidateId,
  });
  await prisma.appSetting.deleteMany({
    where: {
      key,
      userId: input.userId,
    },
  });
}
