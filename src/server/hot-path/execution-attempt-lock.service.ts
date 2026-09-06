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



function isPrismaUniqueViolation(error: unknown) {

  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";

}



function isPrismaConnectionError(error: unknown) {

  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;

  return code === "P1001" || code === "P1002" || code === "P1017";

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

  ownerFenceToken?: string | null;

}): Promise<

  | { ok: true; key: string; fenceToken: string }

  | { ok: false; reason: string; existingExecutionId: string; key: string }

> {

  const candidateId = normalizeCandidateId(input.candidateId);

  const key = buildDurableAttemptKey({

    userId: input.userId,

    executionMode: input.executionMode,

    venue: input.venue,

    candidateId,

  });

  const now = Date.now();

  const leaseMs = Math.max(15_000, input.leaseMs ?? 180_000);

  const fenceToken = input.ownerFenceToken ?? `${input.executionId}:${now}`;

  const value = {

    candidateId,

    executionId: input.executionId,

    decisionId: input.decisionId ?? null,

    executionMode: input.executionMode ?? null,

    venue: input.venue ?? null,

    executionState: "IN_PROGRESS",

    ownerFenceToken: fenceToken,

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

    return { ok: true, key, fenceToken };

  } catch (error) {

    if (isPrismaConnectionError(error)) {

      throw new Error("EXECUTION_CLAIM_DB_UNAVAILABLE");

    }

    if (!isPrismaUniqueViolation(error)) {

      throw error;

    }

    const existing = await prisma.appSetting.findUnique({ where: { key } });

    const payload = (existing?.value as Record<string, unknown> | null) ?? null;

    const existingExecutionId =

      payload && typeof payload.executionId === "string" && payload.executionId.trim().length > 0

        ? payload.executionId

        : input.executionId;

    const leaseExpiresAt = payload?.leaseExpiresAt ? Date.parse(String(payload.leaseExpiresAt)) : 0;

    const expired = Number.isFinite(leaseExpiresAt) && leaseExpiresAt > 0 && leaseExpiresAt <= now;

    return {

      ok: false,

      reason: expired ? "CLAIM_RECONCILE_REQUIRED" : "DUPLICATE_EXECUTION_PATH",

      existingExecutionId,

      key,

    };

  }

}



export async function releaseDurableCanonicalExecutionAttempt(input: {

  userId: string;

  candidateId: string;

  executionId: string;

  ownerFenceToken?: string | null;

  executionMode?: string | null;

  venue?: string | null;

}): Promise<{ ok: true } | { ok: false; reason: string }> {

  const key = buildDurableAttemptKey({

    userId: input.userId,

    executionMode: input.executionMode,

    venue: input.venue,

    candidateId: input.candidateId,

  });

  const existing = await prisma.appSetting.findUnique({ where: { key } });

  if (!existing) return { ok: true };

  const payload = (existing.value as Record<string, unknown> | null) ?? {};

  const ownerExecutionId = String(payload.executionId ?? "");

  const fenceToken = String(payload.ownerFenceToken ?? "");

  if (ownerExecutionId && ownerExecutionId !== input.executionId) {

    return { ok: false, reason: "CLAIM_OWNER_MISMATCH" };

  }

  if (input.ownerFenceToken && fenceToken && fenceToken !== input.ownerFenceToken) {

    return { ok: false, reason: "CLAIM_FENCE_MISMATCH" };

  }

  await prisma.appSetting.deleteMany({

    where: {

      key,

      userId: input.userId,

    },

  });

  return { ok: true };

}



export async function reconcileExpiredDurableExecutionAttempt(input: {

  userId: string;

  candidateId: string;

  executionMode?: string | null;

  venue?: string | null;

  reconcilerExecutionId: string;

  ownerFenceToken?: string | null;

}) {

  const key = buildDurableAttemptKey({

    userId: input.userId,

    executionMode: input.executionMode,

    venue: input.venue,

    candidateId: input.candidateId,

  });

  const existing = await prisma.appSetting.findUnique({ where: { key } });

  if (!existing) return { ok: true, action: "NONE" as const };

  const payload = (existing.value as Record<string, unknown> | null) ?? {};

  const leaseExpiresAt = payload.leaseExpiresAt ? Date.parse(String(payload.leaseExpiresAt)) : 0;

  const now = Date.now();

  if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt > now) {

    return { ok: false, action: "LEASE_ACTIVE" as const, reason: "LEASE_NOT_EXPIRED" };

  }

  const nextFence = input.ownerFenceToken ?? `${input.reconcilerExecutionId}:${now}`;

  await prisma.appSetting.update({

    where: { key },

    data: {

      value: {

        ...payload,

        executionId: input.reconcilerExecutionId,

        ownerFenceToken: nextFence,

        executionState: "RECONCILING",

        leaseExpiresAt: new Date(now + 60_000).toISOString(),

        reconciledAt: new Date(now).toISOString(),

      } as Prisma.InputJsonValue,

    },

  });

  return { ok: true, action: "RECONCILED" as const, fenceToken: nextFence };

}


