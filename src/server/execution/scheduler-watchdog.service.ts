import { logger } from "@/lib/logger";
import { executeSchedulerRecovery } from "@/src/server/execution/scheduler-recovery.service";
import {
  getProcessOwnerId,
  hasLocalSchedulerLoop,
} from "@/src/server/execution/scheduler-ownership.service";

const DEFAULT_WATCHDOG_INTERVAL_MS = 15_000;

type WatchdogHandle = {
  jobId: string;
  ownerId: string;
  startedAt: string;
  tickCount: number;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
  abortController: AbortController;
};

const watchdogRegistry = new Map<string, WatchdogHandle>();
const watchdogQueues = new Map<string, Promise<{ action: "started" | "attached" | "rejected"; jobId: string }>>();

function nowIso() {
  return new Date().toISOString();
}

async function runWatchdogTick(jobId: string, handle: WatchdogHandle) {
  if (handle.abortController.signal.aborted) return;
  handle.tickCount += 1;
  try {
    await executeSchedulerRecovery({
      jobId,
      trigger: "watchdog",
      operator: "automatic",
    });
  } catch (error) {
    logger.warn({ jobId, error: (error as Error).message }, "Watchdog recovery tick failed");
  }
}

async function internalStartWatchdog(jobId: string, intervalMs: number) {
  const existing = watchdogRegistry.get(jobId);
  if (existing && !existing.abortController.signal.aborted) {
    return { action: "attached" as const, jobId };
  }

  if (existing) {
    clearInterval(existing.timer);
    existing.abortController.abort("replaced");
    watchdogRegistry.delete(jobId);
  }

  const abortController = new AbortController();
  const handle: WatchdogHandle = {
    jobId,
    ownerId: getProcessOwnerId(),
    startedAt: nowIso(),
    tickCount: 0,
    intervalMs,
    abortController,
    timer: setInterval(() => {
      void runWatchdogTick(jobId, handle);
    }, intervalMs),
  };

  watchdogRegistry.set(jobId, handle);
  void runWatchdogTick(jobId, handle);
  return { action: "started" as const, jobId };
}

export async function atomicStartSchedulerWatchdog(
  jobId: string,
  intervalMs = DEFAULT_WATCHDOG_INTERVAL_MS,
) {
  const previous = watchdogQueues.get(jobId) ?? Promise.resolve({ action: "attached" as const, jobId });
  const task = previous.catch(() => undefined).then(() => internalStartWatchdog(jobId, intervalMs));
  watchdogQueues.set(jobId, task);
  const result = await task;
  if (watchdogQueues.get(jobId) === task) {
    watchdogQueues.delete(jobId);
  }
  return result;
}

export function stopSchedulerWatchdog(jobId: string) {
  const handle = watchdogRegistry.get(jobId);
  if (!handle) return false;
  clearInterval(handle.timer);
  handle.abortController.abort("stopped");
  watchdogRegistry.delete(jobId);
  return true;
}

export function getWatchdogRegistrySnapshot() {
  return {
    activeCount: watchdogRegistry.size,
    entries: Array.from(watchdogRegistry.values()).map((row) => ({
      jobId: row.jobId,
      ownerId: row.ownerId,
      startedAt: row.startedAt,
      tickCount: row.tickCount,
      intervalMs: row.intervalMs,
      hasSchedulerLoop: hasLocalSchedulerLoop(row.jobId),
    })),
  };
}

export function resetSchedulerWatchdogForTests() {
  for (const handle of watchdogRegistry.values()) {
    clearInterval(handle.timer);
    handle.abortController.abort("test-reset");
  }
  watchdogRegistry.clear();
  watchdogQueues.clear();
}

export { watchdogRegistry, DEFAULT_WATCHDOG_INTERVAL_MS };
