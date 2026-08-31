import { randomUUID } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type {
  RecoveryAuditEvent,
  RecoveryFailureKind,
  RecoveryState,
} from "@/src/server/execution/scheduler-recovery.types";

const RECOVERY_AUDIT_KEY = "recoveryAudit";
const RECOVERY_STATE_KEY = "recoveryState";
const MAX_AUDIT_EVENTS = 100;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const MAX_RECOVERIES_PER_WINDOW = 12;
const NO_ACTION_COALESCE_WINDOW_MS = 60_000;

function defaultRecoveryState(): RecoveryState {
  return {
    recoveryCount: 0,
    recoverySuccess: 0,
    recoveryFailure: 0,
    lastRecoveryAt: null,
    lastCause: null,
    lastDurationMs: 0,
    escalationLevel: 0,
    windowStartedAt: new Date().toISOString(),
  };
}

export function readRecoveryStateFromMetadata(metadata: unknown): RecoveryState {
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const raw = meta[RECOVERY_STATE_KEY];
  if (!raw || typeof raw !== "object") return defaultRecoveryState();
  const row = raw as Partial<RecoveryState>;
  return {
    ...defaultRecoveryState(),
    ...row,
    recoveryCount: Number(row.recoveryCount ?? 0),
    recoverySuccess: Number(row.recoverySuccess ?? 0),
    recoveryFailure: Number(row.recoveryFailure ?? 0),
    escalationLevel: Number(row.escalationLevel ?? 0),
  };
}

export function readRecoveryAuditFromMetadata(metadata: unknown): RecoveryAuditEvent[] {
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const raw = meta[RECOVERY_AUDIT_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean) as RecoveryAuditEvent[];
}

export async function readRecoveryState(jobId: string) {
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    select: { metadata: true },
  });
  if (!job) return null;
  return readRecoveryStateFromMetadata(job.metadata);
}

export async function readRecoveryAuditTrail(jobId: string, limit = 50) {
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    select: { metadata: true },
  });
  if (!job) return [];
  return readRecoveryAuditFromMetadata(job.metadata).slice(0, limit);
}

export function normalizeRecoveryWindow(state: RecoveryState): RecoveryState {
  const windowStart = new Date(state.windowStartedAt).getTime();
  if (!Number.isFinite(windowStart) || Date.now() - windowStart > RECOVERY_WINDOW_MS) {
    return {
      ...state,
      recoveryCount: 0,
      recoverySuccess: 0,
      recoveryFailure: 0,
      escalationLevel: 0,
      windowStartedAt: new Date().toISOString(),
    };
  }
  return state;
}

export function computeEscalationLevel(state: RecoveryState) {
  const normalized = normalizeRecoveryWindow(state);
  if (normalized.recoveryCount >= MAX_RECOVERIES_PER_WINDOW) return 5;
  if (normalized.recoveryFailure >= 8) return 4;
  if (normalized.recoveryFailure >= 5) return 3;
  if (normalized.recoveryCount >= 6) return 2;
  if (normalized.recoveryCount >= 3) return 1;
  return 0;
}

export async function appendRecoveryAuditEvent(input: {
  jobId: string;
  event: Omit<RecoveryAuditEvent, "id" | "timestamp">;
}) {
  return prisma.$transaction(async (tx) => {
    const job = await tx.autoRoundJob.findUnique({
      where: { id: input.jobId },
      select: { metadata: true, persistVersion: true },
    });
    if (!job) return null;

    const meta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const audit = readRecoveryAuditFromMetadata(meta);
    const state = normalizeRecoveryWindow(readRecoveryStateFromMetadata(meta));

    const event: RecoveryAuditEvent = {
      ...input.event,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    if (event.action === "NO_ACTION" && event.result === "skipped" && audit.length > 0) {
      const latest = audit[0];
      const latestTs = new Date(latest.timestamp).getTime();
      const nowTs = new Date(event.timestamp).getTime();
      const sameDecision =
        latest.action === "NO_ACTION" &&
        latest.result === "skipped" &&
        latest.failure === event.failure &&
        latest.component === event.component;
      if (sameDecision && Number.isFinite(latestTs) && Number.isFinite(nowTs) && nowTs - latestTs < NO_ACTION_COALESCE_WINDOW_MS) {
        return { event, state };
      }
    }

    const incrementCounter =
      event.action !== "NO_ACTION" &&
      event.result !== "skipped" &&
      !(event.result === "success" && event.action === "RECONCILE" && event.failure === "REGISTRY_INTEGRITY");
    const nextRecoveryCount = state.recoveryCount + (incrementCounter ? 1 : 0);
    const nextRecoveryFailure = state.recoveryFailure + (event.result === "failure" && incrementCounter ? 1 : 0);
    const nextRecoverySuccess = state.recoverySuccess + (event.result === "success" && incrementCounter ? 1 : 0);
    const registryReconcileSuccess =
      event.result === "success" && event.action === "RECONCILE" && event.failure === "REGISTRY_INTEGRITY";
    const nextState: RecoveryState = {
      ...state,
      recoveryCount: nextRecoveryCount,
      recoverySuccess: nextRecoverySuccess,
      recoveryFailure: registryReconcileSuccess ? 0 : nextRecoveryFailure,
      lastRecoveryAt: incrementCounter ? event.timestamp : state.lastRecoveryAt,
      lastCause: incrementCounter ? event.failure : state.lastCause,
      lastDurationMs: incrementCounter ? event.durationMs : state.lastDurationMs,
      escalationLevel: computeEscalationLevel({
        ...state,
        recoveryCount: nextRecoveryCount,
        recoveryFailure: nextRecoveryFailure,
      }),
    };

    const nextAudit = [event, ...audit].slice(0, MAX_AUDIT_EVENTS);
    const updated = await tx.autoRoundJob.updateMany({
      where: { id: input.jobId, persistVersion: job.persistVersion },
      data: {
        persistVersion: { increment: 1 },
        metadata: {
          ...meta,
          [RECOVERY_AUDIT_KEY]: nextAudit,
          [RECOVERY_STATE_KEY]: nextState,
        } as never,
      },
    });
    if (updated.count !== 1) {
      const latest = await tx.autoRoundJob.findUnique({
        where: { id: input.jobId },
        select: { metadata: true },
      });
      return {
        event,
        state: latest ? readRecoveryStateFromMetadata(latest.metadata) : nextState,
      };
    }

    return { event, state: nextState };
  }, { timeout: 20_000, maxWait: 10_000 });
}

export async function pingDatabaseConnectivity() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true as const, latencyMs: 0 };
  } catch (error) {
    return { ok: false as const, error: (error as Error).message };
  }
}

export function shouldStopDueToRecoveryLimits(state: RecoveryState, failure: RecoveryFailureKind) {
  const normalized = normalizeRecoveryWindow(state);
  const level = computeEscalationLevel(normalized);
  if (level >= 5) {
    return { stop: true, reason: `Recovery limit exceeded (${normalized.recoveryCount}/${MAX_RECOVERIES_PER_WINDOW})` };
  }
  if (level >= 4 && failure !== "WAITING_RUN_OVERDUE") {
    return { stop: false, escalate: true, level };
  }
  return { stop: false, escalate: level >= 3, level };
}

export { MAX_RECOVERIES_PER_WINDOW, RECOVERY_WINDOW_MS };
