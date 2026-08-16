import type {
  AcquireRoundOwnershipResult,
  RoundLifecycleStatus,
  RoundOwnershipRecord,
  RoundRegistryRecoveryReport,
  RoundRegistrySnapshot,
} from "@/src/server/execution/round-registry.types";

const IN_PROGRESS_STATUSES: RoundLifecycleStatus[] = [
  "ROUND_CREATED",
  "OWNERSHIP_ACQUIRED",
  "SELECTION_RUNNING",
  "EXECUTION_RUNNING",
];

const TERMINAL_STATUSES: RoundLifecycleStatus[] = [
  "ROUND_COMPLETED",
  "ROUND_FAILED",
  "OWNERSHIP_RELEASED",
];

function roundKey(jobId: string, roundNo: number) {
  return `${jobId}#${roundNo}`;
}

function nowIso() {
  return new Date().toISOString();
}

const roundRegistry = new Map<string, RoundOwnershipRecord>();
const acquireQueues = new Map<string, Promise<AcquireRoundOwnershipResult>>();
const transitionLocks = new Map<string, Promise<void>>();

async function withRoundTransitionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = transitionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => gate);
  transitionLocks.set(key, chained);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (transitionLocks.get(key) === chained) {
      transitionLocks.delete(key);
    }
  }
}

function isActiveRecord(record: RoundOwnershipRecord | undefined) {
  if (!record) return false;
  return IN_PROGRESS_STATUSES.includes(record.status);
}

export function getRoundOwnershipRecord(jobId: string, roundNo: number) {
  return roundRegistry.get(roundKey(jobId, roundNo)) ?? null;
}

export function getActiveRoundOwnershipForJob(jobId: string) {
  const active: RoundOwnershipRecord[] = [];
  for (const record of roundRegistry.values()) {
    if (record.jobId === jobId && isActiveRecord(record)) {
      active.push(record);
    }
  }
  return active.sort((a, b) => b.roundNo - a.roundNo);
}

export function getRoundRegistrySnapshot(): RoundRegistrySnapshot {
  const entries = Array.from(roundRegistry.values());
  return {
    entries,
    activeCount: entries.filter((row) => isActiveRecord(row)).length,
  };
}

export async function atomicAcquireRoundOwnership(input: {
  jobId: string;
  roundNo: number;
  ownerId: string;
  persistAcquire: () => Promise<{ action: "created" | "attached"; runId: string }>;
}): Promise<AcquireRoundOwnershipResult> {
  const key = roundKey(input.jobId, input.roundNo);
  const previous = acquireQueues.get(key) ?? Promise.resolve({
    action: "attached" as const,
    record: null,
  });
  const task = previous
    .catch(() => undefined)
    .then(async (): Promise<AcquireRoundOwnershipResult> => {
      return withRoundTransitionLock(key, async () => {
        const existing = roundRegistry.get(key);
        if (existing && isActiveRecord(existing)) {
          return {
            action: "attached",
            record: existing,
            reason: "Round ownership already held",
          };
        }

        const persisted = await input.persistAcquire();
        const now = nowIso();
        const record: RoundOwnershipRecord = {
          jobId: input.jobId,
          roundNo: input.roundNo,
          roundOwner: input.ownerId,
          runId: persisted.runId,
          status: "OWNERSHIP_ACQUIRED",
          version: (existing?.version ?? 0) + 1,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        roundRegistry.set(key, record);
        return {
          action: persisted.action === "created" ? "acquired" : "attached",
          record,
        };
      });
    });
  acquireQueues.set(key, task);
  const result = await task;
  if (acquireQueues.get(key) === task) {
    acquireQueues.delete(key);
  }
  return result;
}

export async function transitionRoundLifecycle(input: {
  jobId: string;
  roundNo: number;
  runId: string;
  ownerId: string;
  status: RoundLifecycleStatus;
}) {
  const key = roundKey(input.jobId, input.roundNo);
  return withRoundTransitionLock(key, async () => {
    const current = roundRegistry.get(key);
    if (!current) return null;
    if (current.runId !== input.runId) return null;
    if (current.roundOwner !== input.ownerId) return null;
    if (TERMINAL_STATUSES.includes(current.status) && input.status !== "OWNERSHIP_RELEASED") {
      return current;
    }
    const next: RoundOwnershipRecord = {
      ...current,
      status: input.status,
      version: current.version + 1,
      updatedAt: nowIso(),
    };
    roundRegistry.set(key, next);
    return next;
  });
}

export async function releaseRoundOwnership(input: {
  jobId: string;
  roundNo: number;
  runId: string;
  ownerId: string;
  finalStatus: Extract<RoundLifecycleStatus, "ROUND_COMPLETED" | "ROUND_FAILED" | "OWNERSHIP_RELEASED">;
}) {
  const key = roundKey(input.jobId, input.roundNo);
  return withRoundTransitionLock(key, async () => {
    const current = roundRegistry.get(key);
    if (!current) return null;
    if (current.runId !== input.runId) return null;
    const next: RoundOwnershipRecord = {
      ...current,
      status: input.finalStatus,
      version: current.version + 1,
      updatedAt: nowIso(),
    };
    roundRegistry.set(key, next);
    if (input.finalStatus !== "OWNERSHIP_RELEASED") {
      const released: RoundOwnershipRecord = {
        ...next,
        status: "OWNERSHIP_RELEASED",
        version: next.version + 1,
        updatedAt: nowIso(),
      };
      roundRegistry.set(key, released);
      return released;
    }
    return next;
  });
}

export function recoverRoundRegistryFromRuns(input: {
  jobId: string;
  ownerId: string;
  runs: Array<{
    id: string;
    roundNo: number;
    state: string;
    startedAt: Date;
    endedAt?: Date | null;
  }>;
  inProgressStates: string[];
  onDuplicateRun?: (runId: string, roundNo: number) => Promise<void>;
}): RoundRegistryRecoveryReport {
  const report: RoundRegistryRecoveryReport = {
    rebuilt: 0,
    orphansFailed: 0,
    duplicatesConsolidated: 0,
    staleReleased: 0,
  };

  const grouped = new Map<number, typeof input.runs>();
  for (const run of input.runs) {
    if (!run.endedAt && input.inProgressStates.includes(run.state)) {
      const bucket = grouped.get(run.roundNo) ?? [];
      bucket.push(run);
      grouped.set(run.roundNo, bucket);
    }
  }

  for (const [roundNo, bucket] of grouped.entries()) {
    const sorted = [...bucket].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    const canonical = sorted[0];
    const key = roundKey(input.jobId, roundNo);
    roundRegistry.set(key, {
      jobId: input.jobId,
      roundNo,
      roundOwner: input.ownerId,
      runId: canonical.id,
      status: "OWNERSHIP_ACQUIRED",
      version: 1,
      createdAt: canonical.startedAt.toISOString(),
      updatedAt: nowIso(),
    });
    report.rebuilt += 1;

    for (const duplicate of sorted.slice(1)) {
      report.duplicatesConsolidated += 1;
      void input.onDuplicateRun?.(duplicate.id, roundNo);
    }
  }

  for (const [key, record] of roundRegistry.entries()) {
    if (!key.startsWith(`${input.jobId}#`)) continue;
    if (!isActiveRecord(record)) continue;
    const stillExists = input.runs.some(
      (run) => run.id === record.runId && !run.endedAt && input.inProgressStates.includes(run.state),
    );
    if (!stillExists) {
      roundRegistry.set(key, {
        ...record,
        status: "OWNERSHIP_RELEASED",
        version: record.version + 1,
        updatedAt: nowIso(),
      });
      report.staleReleased += 1;
    }
  }

  return report;
}

/** Test-only reset */
export function resetRoundRegistryForTests() {
  roundRegistry.clear();
  acquireQueues.clear();
  transitionLocks.clear();
}

export { roundRegistry, acquireQueues, roundKey, isActiveRecord };
