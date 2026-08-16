import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { logger } from "@/lib/logger";
import type {
  AtomicSpawnResult,
  SchedulerLease,
  SchedulerLoopContext,
  SchedulerOwnershipState,
  SchedulerRegistrySnapshot,
} from "@/src/server/execution/scheduler-ownership.types";

const PROCESS_OWNER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const LEASE_STALE_MS = 45_000;

type LoopHandle = {
  promise: Promise<void>;
  ownerId: string;
  generation: number;
  abortController: AbortController;
};

export type LeasePersistence = {
  loadLease: (jobId: string) => Promise<SchedulerLease | null>;
  persistLease: (input: {
    jobId: string;
    lease: SchedulerLease;
    expectedVersion: number | null;
  }) => Promise<{ ok: boolean; lease: SchedulerLease | null }>;
};

const loopRegistry = new Map<string, LoopHandle>();
const ownerRegistry = new Map<string, SchedulerLease>();
const spawnQueues = new Map<string, Promise<AtomicSpawnResult>>();
const transitionLocks = new Map<string, Promise<void>>();

function nowIso() {
  return new Date().toISOString();
}

function isLiveLease(lease: SchedulerLease | null | undefined, excludeOwnerId?: string) {
  if (!lease) return false;
  if (lease.state !== "RUNNING" && lease.state !== "STARTING") return false;
  if (excludeOwnerId && lease.ownerId === excludeOwnerId) return false;
  const ageMs = Date.now() - new Date(lease.lastHeartbeatAt).getTime();
  return ageMs < LEASE_STALE_MS;
}

async function withTransitionLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const previous = transitionLocks.get(jobId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => gate);
  transitionLocks.set(jobId, chained);
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (transitionLocks.get(jobId) === chained) {
      transitionLocks.delete(jobId);
    }
  }
}

function setLocalLease(jobId: string, lease: SchedulerLease) {
  ownerRegistry.set(jobId, lease);
}

export function getProcessOwnerId() {
  return PROCESS_OWNER_ID;
}

export function hasLocalSchedulerLoop(jobId: string) {
  return loopRegistry.has(jobId);
}

export function isSchedulerLeaseStale(lease: SchedulerLease | null | undefined) {
  if (!lease) return true;
  const ageMs = Date.now() - new Date(lease.lastHeartbeatAt).getTime();
  return ageMs >= LEASE_STALE_MS;
}

export function isSchedulerLeaseLive(lease: SchedulerLease | null | undefined, excludeOwnerId?: string) {
  return isLiveLease(lease, excludeOwnerId);
}

export function getSchedulerLeaseSnapshot(jobId: string) {
  return ownerRegistry.get(jobId) ?? null;
}

export function getSchedulerRegistrySnapshot(): SchedulerRegistrySnapshot {
  return {
    processOwnerId: PROCESS_OWNER_ID,
    loopCount: loopRegistry.size,
    ownerCount: ownerRegistry.size,
    loops: Array.from(loopRegistry.entries()).map(([jobId, handle]) => ({
      jobId,
      ownerId: handle.ownerId,
      generation: handle.generation,
    })),
    leases: Array.from(ownerRegistry.entries()).map(([jobId, lease]) => ({
      jobId,
      state: lease.state,
      generation: lease.generation,
      ownerId: lease.ownerId,
    })),
  };
}

export function assertSchedulerLoopOwnership(jobId: string, ctx: SchedulerLoopContext) {
  const handle = loopRegistry.get(jobId);
  if (!handle) {
    throw new Error(`Scheduler loop missing for job ${jobId}`);
  }
  if (handle.ownerId !== ctx.ownerId || handle.generation !== ctx.generation) {
    throw new Error(`Scheduler generation mismatch for job ${jobId}`);
  }
  const lease = ownerRegistry.get(jobId);
  if (!lease || lease.ownerId !== ctx.ownerId || lease.generation !== ctx.generation) {
    throw new Error(`Scheduler lease mismatch for job ${jobId}`);
  }
  if (ctx.signal.aborted) {
    throw new Error(`Scheduler aborted for job ${jobId}`);
  }
}

export async function touchSchedulerLease(
  jobId: string,
  ctx: SchedulerLoopContext,
  persistence?: LeasePersistence,
) {
  assertSchedulerLoopOwnership(jobId, ctx);
  const current = ownerRegistry.get(jobId);
  if (!current) return;
  const next: SchedulerLease = {
    ...current,
    lastHeartbeatAt: nowIso(),
    state: "RUNNING",
  };
  setLocalLease(jobId, next);
  if (persistence) {
    await persistence.persistLease({
      jobId,
      lease: next,
      expectedVersion: current.version,
    });
  }
}

async function transitionLeaseState(
  jobId: string,
  ctx: Pick<SchedulerLoopContext, "ownerId" | "generation">,
  state: SchedulerOwnershipState,
  persistence?: LeasePersistence,
) {
  await withTransitionLock(jobId, async () => {
    const current = ownerRegistry.get(jobId);
    if (!current || current.ownerId !== ctx.ownerId || current.generation !== ctx.generation) {
      return;
    }
    if (current.state === state) return;
    const next: SchedulerLease = {
      ...current,
      state,
      lastHeartbeatAt: nowIso(),
    };
    if (persistence) {
      const result = await persistence.persistLease({
        jobId,
        lease: next,
        expectedVersion: current.version,
      });
      if (result.ok && result.lease) {
        setLocalLease(jobId, result.lease);
        return;
      }
    }
    setLocalLease(jobId, next);
  });
}

export async function markSchedulerStopping(
  jobId: string,
  ctx: SchedulerLoopContext,
  persistence?: LeasePersistence,
) {
  const handle = loopRegistry.get(jobId);
  if (handle && handle.ownerId === ctx.ownerId && handle.generation === ctx.generation) {
    handle.abortController.abort("Scheduler stopping");
  }
  await transitionLeaseState(jobId, ctx, "STOPPING", persistence);
}

export async function releaseSchedulerOwnership(
  jobId: string,
  ctx: SchedulerLoopContext,
  finalState: Extract<SchedulerOwnershipState, "STOPPED" | "FAILED">,
  persistence?: LeasePersistence,
) {
  await withTransitionLock(jobId, async () => {
    const handle = loopRegistry.get(jobId);
    if (handle && handle.ownerId === ctx.ownerId && handle.generation === ctx.generation) {
      loopRegistry.delete(jobId);
    }
    const current = ownerRegistry.get(jobId);
    if (!current || current.ownerId !== ctx.ownerId || current.generation !== ctx.generation) {
      return;
    }
    const next: SchedulerLease = {
      ...current,
      state: finalState,
      lastHeartbeatAt: nowIso(),
    };
    if (persistence) {
      await persistence.persistLease({
        jobId,
        lease: next,
        expectedVersion: current.version,
      });
    }
    setLocalLease(jobId, next);
  });
}

async function internalAtomicSpawn(
  jobId: string,
  startLoop: (ctx: SchedulerLoopContext) => Promise<void>,
  persistence?: LeasePersistence,
): Promise<AtomicSpawnResult> {
  return withTransitionLock(jobId, async () => {
    const existingLoop = loopRegistry.get(jobId);
    if (existingLoop) {
      const lease = ownerRegistry.get(jobId);
      return {
        action: "attached",
        jobId,
        ownerId: existingLoop.ownerId,
        generation: existingLoop.generation,
        reason: lease?.state ?? "RUNNING",
      };
    }

    const loaded = persistence ? await persistence.loadLease(jobId) : null;
    if (isLiveLease(loaded, PROCESS_OWNER_ID)) {
      return {
        action: "rejected",
        jobId,
        ownerId: loaded!.ownerId,
        generation: loaded!.generation,
        reason: "Lease owned by another scheduler instance",
      };
    }

    const nextGeneration = Math.max(loaded?.generation ?? 0, ownerRegistry.get(jobId)?.generation ?? 0) + 1;
    const startingLease: SchedulerLease = {
      jobId,
      ownerId: PROCESS_OWNER_ID,
      createdAt: nowIso(),
      lastHeartbeatAt: nowIso(),
      version: loaded?.version ?? 0,
      generation: nextGeneration,
      state: "STARTING",
    };

    if (persistence) {
      const acquired = await persistence.persistLease({
        jobId,
        lease: startingLease,
        expectedVersion: loaded?.version ?? null,
      });
      if (!acquired.ok || !acquired.lease) {
        if (isLiveLease(acquired.lease, PROCESS_OWNER_ID)) {
          return {
            action: "rejected",
            jobId,
            ownerId: acquired.lease!.ownerId,
            generation: acquired.lease!.generation,
            reason: "Lease CAS rejected",
          };
        }
        return {
          action: "rejected",
          jobId,
          ownerId: PROCESS_OWNER_ID,
          generation: nextGeneration,
          reason: "Lease persist failed",
        };
      }
      setLocalLease(jobId, acquired.lease);
    } else {
      setLocalLease(jobId, { ...startingLease, version: startingLease.version + 1 });
    }

    const activeLease = ownerRegistry.get(jobId)!;
    const abortController = new AbortController();
    const ctx: SchedulerLoopContext = {
      ownerId: PROCESS_OWNER_ID,
      generation: activeLease.generation,
      signal: abortController.signal,
    };

    const loopPromise = (async () => {
      try {
        await transitionLeaseState(jobId, ctx, "RUNNING", persistence);
        await startLoop(ctx);
      } catch (error) {
        logger.error({ jobId, error: (error as Error).message }, "Scheduler loop crashed");
        await releaseSchedulerOwnership(jobId, ctx, "FAILED", persistence);
        throw error;
      } finally {
        if (!ctx.signal.aborted) {
          await releaseSchedulerOwnership(jobId, ctx, "STOPPED", persistence);
        }
      }
    })();

    loopRegistry.set(jobId, {
      promise: loopPromise,
      ownerId: PROCESS_OWNER_ID,
      generation: activeLease.generation,
      abortController,
    });

    void loopPromise.catch(() => null);

    return {
      action: "spawned",
      jobId,
      ownerId: PROCESS_OWNER_ID,
      generation: activeLease.generation,
    };
  });
}

export async function atomicSpawnScheduler(
  jobId: string,
  startLoop: (ctx: SchedulerLoopContext) => Promise<void>,
  persistence?: LeasePersistence,
): Promise<AtomicSpawnResult> {
  const previous = spawnQueues.get(jobId) ?? Promise.resolve({
    action: "attached" as const,
    jobId,
    ownerId: PROCESS_OWNER_ID,
    generation: 0,
  });
  const task = previous
    .catch(() => undefined)
    .then(() => internalAtomicSpawn(jobId, startLoop, persistence));
  spawnQueues.set(jobId, task);
  const result = await task;
  if (spawnQueues.get(jobId) === task) {
    spawnQueues.delete(jobId);
  }
  return result;
}

export async function awaitSchedulerLoop(jobId: string) {
  const handle = loopRegistry.get(jobId);
  if (!handle) return;
  await handle.promise.catch(() => null);
}

/** Test-only reset */
export function resetSchedulerOwnershipForTests() {
  for (const handle of loopRegistry.values()) {
    handle.abortController.abort("test-reset");
  }
  loopRegistry.clear();
  ownerRegistry.clear();
  spawnQueues.clear();
  transitionLocks.clear();
}

export { loopRegistry, ownerRegistry, spawnQueues };
