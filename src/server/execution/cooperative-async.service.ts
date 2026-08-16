import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { RoundSelectionAbortError } from "@/src/server/execution/round-runtime.types";
import {
  assessRoundProgressState,
  shouldBlockRecoveryRestart,
} from "@/src/server/execution/round-progress-state.service";
import {
  withCancellableBoundedAwait,
  remainingMsUntil,
  linkAbortSignal,
  throwIfAborted,
} from "@/src/server/execution/cancellable-work.service";
import {
  CooperativeAsyncCancelledError,
  CooperativeAsyncTimeoutError,
  createAsyncTelemetry,
  type AsyncRuntimeTelemetry,
  type AsyncTelemetryEvent,
} from "@/src/server/execution/cooperative-async.types";

export {
  CooperativeAsyncCancelledError,
  CooperativeAsyncTimeoutError,
  createAsyncTelemetry,
  type AsyncRuntimeTelemetry,
  type AsyncTelemetryEvent,
};

function pushTelemetry(telemetry: AsyncRuntimeTelemetry, event: Omit<AsyncTelemetryEvent, "at">) {
  const row: AsyncTelemetryEvent = { ...event, at: new Date().toISOString() };
  telemetry.events.push(row);
  if (telemetry.events.length > 200) telemetry.events.shift();
  if (typeof event.awaitMs === "number") {
    telemetry.maxAwaitMs = Math.max(telemetry.maxAwaitMs, event.awaitMs);
  }
}

export function resolveAsyncWorkerTimeoutMs() {
  return Math.max(5_000, Math.min(600_000, env.AUTO_ROUND_ASYNC_WORKER_TIMEOUT_MS ?? 120_000));
}

export function resolveDiscoveryItemTimeoutMs() {
  return Math.max(1_000, Math.min(120_000, env.AUTO_ROUND_DISCOVERY_ITEM_TIMEOUT_MS ?? 30_000));
}

export function resolveMarketContextTimeoutMs() {
  return Math.max(3_000, Math.min(180_000, env.AUTO_ROUND_MARKET_CONTEXT_TIMEOUT_MS ?? 45_000));
}

export function resolveAiConsensusTimeoutMs() {
  return Math.max(5_000, Math.min(300_000, env.AUTO_ROUND_AI_CONSENSUS_TIMEOUT_MS ?? 90_000));
}

export function resolveAiPhaseDeadlineMs(selectionDeadlineMs?: number) {
  const minBudgetMs = Math.max(60_000, (env.AUTO_ROUND_AI_PHASE_MAX_SEC ?? 900) * 1000);
  const fallback = Date.now() + minBudgetMs;
  if (typeof selectionDeadlineMs === "number" && selectionDeadlineMs > Date.now()) {
    return Math.max(Date.now() + 60_000, Math.min(selectionDeadlineMs, fallback));
  }
  return fallback;
}

export function resolveAsyncHeartbeatPollMs() {
  return Math.max(500, Math.min(10_000, env.AUTO_ROUND_ASYNC_HEARTBEAT_POLL_MS ?? 2_000));
}

export function resolveScannerAiWorkerTimeoutMs() {
  const perCandidateBudget =
    resolveMarketContextTimeoutMs() * 2 + resolveAiConsensusTimeoutMs();
  return Math.max(resolveAsyncWorkerTimeoutMs(), perCandidateBudget);
}

export function resolveRoundWatchdogStaleMs() {
  const configured = Math.max(15_000, Math.min(600_000, env.AUTO_ROUND_WATCHDOG_STALE_MS ?? 180_000));
  const floor = resolveAiConsensusTimeoutMs() + Math.floor(resolveAsyncWorkerTimeoutMs() / 4) + 30_000;
  return Math.max(configured, floor);
}

export function startPeriodicRuntimeHeartbeat(
  onHeartbeat?: () => void | Promise<void>,
  pollMs?: number,
): () => void {
  if (!onHeartbeat) return () => undefined;
  const intervalMs = pollMs ?? resolveAsyncHeartbeatPollMs();
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    void (async () => {
      try {
        await onHeartbeat();
      } catch (error) {
        if (isFatalCooperativeError(error)) {
          stopped = true;
          clearInterval(timer);
        }
        logger.warn({ error: (error as Error).message }, "Periodic runtime heartbeat failed");
      }
    })();
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function isFatalCooperativeError(error: unknown) {
  return error instanceof RoundSelectionAbortError || error instanceof CooperativeAsyncCancelledError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type BoundedWork<T> = Promise<T> | ((signal: AbortSignal) => Promise<T>);

function normalizeWork<T>(work: BoundedWork<T>): (signal: AbortSignal) => Promise<T> {
  if (typeof work === "function") return work;
  return (signal: AbortSignal) =>
    Promise.race([
      work,
      new Promise<never>((_, reject) => {
        if (signal.aborted) {
          reject(new CooperativeAsyncCancelledError(String(signal.reason ?? "Aborted")));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(new CooperativeAsyncCancelledError(String(signal.reason ?? "Aborted"))),
          { once: true },
        );
      }),
    ]);
}

/** Bounded await — rejects on timeout and propagates cancellation to linked AbortSignal. */
export async function withBoundedAwait<T>(
  label: string,
  work: BoundedWork<T>,
  timeoutMs: number,
  telemetry?: AsyncRuntimeTelemetry,
  meta?: Record<string, unknown>,
  options?: { signal?: AbortSignal },
): Promise<T> {
  return withCancellableBoundedAwait(label, normalizeWork(work), timeoutMs, {
    signal: options?.signal,
    telemetry,
    meta,
  });
}

export type CooperativePoolOptions<T> = {
  label: string;
  concurrency: number;
  workerTimeoutMs: number;
  stageTimeoutMs?: number;
  deadlineMs?: number;
  selectionDeadlineMs?: number;
  selectionBudgetMs?: number;
  abortSignal?: AbortSignal;
  shouldAbort?: () => void;
  onHeartbeat?: () => void | Promise<void>;
  heartbeatIntervalMs?: number;
  onItemStart?: (index: number, total: number, item: T) => void | Promise<void>;
  onItemComplete?: (
    processed: number,
    total: number,
    item: T,
    result: unknown,
    error?: Error,
  ) => void | Promise<void>;
  onWorkerTimeout?: (index: number, total: number, item: T, error: Error) => void | Promise<void>;
  telemetry?: AsyncRuntimeTelemetry;
};

/**
 * Cooperative worker pool — each item is timeout-isolated; stalled workers never freeze the stage.
 */
export async function runCooperativePool<T, R>(
  items: T[],
  worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options: CooperativePoolOptions<T>,
): Promise<Array<R | null>> {
  if (items.length === 0) return [];
  const telemetry = options.telemetry ?? createAsyncTelemetry();
  const results: Array<R | null> = new Array(items.length).fill(null);
  const concurrency = Math.max(1, Math.min(options.concurrency, items.length));
  let next = 0;
  let stopScheduling = false;
  const stageDeadline =
    options.deadlineMs ??
    (options.stageTimeoutMs ? Date.now() + Math.max(1, options.stageTimeoutMs) : undefined);
  const poolAbort = linkAbortSignal(options.abortSignal);
  const pollMs = options.heartbeatIntervalMs ?? resolveAsyncHeartbeatPollMs();

  const enforceBudget = () => {
    if (!options.selectionDeadlineMs) return;
    if (Date.now() < options.selectionDeadlineMs) return;
    if (poolAbort.signal.aborted) return;
    poolAbort.abort("Selection budget expired");
    stopScheduling = true;
    telemetry.stageTimeouts += 1;
    pushTelemetry(telemetry, {
      kind: "budget",
      label: options.label,
      message: `Selection budget expired for ${options.label}`,
    });
    throw new RoundSelectionAbortError(
      "BUDGET_EXPIRED",
      `Tur secim suresi doldu (${Math.floor((options.selectionBudgetMs ?? 1_200_000) / 1000)}s)`,
    );
  };

  try {
    options.shouldAbort?.();
    enforceBudget();
  } catch (error) {
    if (isFatalCooperativeError(error)) throw error;
  }

  const budgetTimer =
    typeof options.selectionDeadlineMs === "number"
      ? setInterval(() => {
          try {
            enforceBudget();
          } catch (error) {
            stopScheduling = true;
            if (isFatalCooperativeError(error)) {
              logger.warn({ label: options.label, error: (error as Error).message }, "Pool budget abort");
            }
          }
        }, Math.min(1000, pollMs))
      : undefined;

  const heartbeatTimer = setInterval(() => {
    void (async () => {
      try {
        enforceBudget();
        options.shouldAbort?.();
        pushTelemetry(telemetry, {
          kind: "heartbeat",
          label: options.label,
          message: `heartbeat ${options.label}`,
        });
        await options.onHeartbeat?.();
      } catch (error) {
        stopScheduling = true;
        if (!poolAbort.signal.aborted && error instanceof RoundSelectionAbortError) {
          poolAbort.abort((error as Error).message);
        }
        if (isFatalCooperativeError(error)) {
          logger.warn({ label: options.label, error: (error as Error).message }, "Cooperative pool heartbeat abort");
          return;
        }
        logger.warn({ label: options.label, error: (error as Error).message }, "Cooperative pool heartbeat failed");
      }
    })();
  }, pollMs);

  const runners = Array.from({ length: concurrency }).map(async () => {
    while (!stopScheduling) {
      throwIfAborted(poolAbort.signal, `${options.label} pool aborted`);
      try {
        enforceBudget();
        options.shouldAbort?.();
      } catch (error) {
        stopScheduling = true;
        if (isFatalCooperativeError(error)) throw error;
        break;
      }
      if (stageDeadline && Date.now() >= stageDeadline) {
        if (!stopScheduling) {
          stopScheduling = true;
          poolAbort.abort("Stage deadline reached");
          telemetry.stageTimeouts += 1;
          pushTelemetry(telemetry, {
            kind: "stage_timeout",
            label: options.label,
            message: `Stage deadline reached for ${options.label}`,
          });
        }
        break;
      }
      const idx = next;
      next += 1;
      if (idx >= items.length) break;

      telemetry.workerStarted += 1;
      pushTelemetry(telemetry, {
        kind: "worker_start",
        label: options.label,
        message: `worker ${idx + 1}/${items.length}`,
        meta: { index: idx },
      });
      const started = Date.now();
      const workerAbort = linkAbortSignal(poolAbort.signal);
      const budgetRemaining = remainingMsUntil(options.selectionDeadlineMs);
      const effectiveTimeout = Math.max(
        1,
        Math.min(options.workerTimeoutMs, budgetRemaining, remainingMsUntil(stageDeadline)),
      );
      try {
        await options.onItemStart?.(idx, items.length, items[idx]);
        const value = await withCancellableBoundedAwait(
          `${options.label}#${idx}`,
          (signal) => worker(items[idx], idx, signal),
          effectiveTimeout,
          { signal: workerAbort.signal, telemetry, meta: { index: idx } },
        );
        results[idx] = value;
        telemetry.workerCompleted += 1;
        await options.onItemComplete?.(idx + 1, items.length, items[idx], value);
      } catch (error) {
        const awaitMs = Date.now() - started;
        if (error instanceof CooperativeAsyncTimeoutError) {
          telemetry.workerTimedOut += 1;
          telemetry.workerStalled += 1;
          pushTelemetry(telemetry, {
            kind: "worker_timeout",
            label: options.label,
            message: (error as Error).message,
            awaitMs,
            meta: { index: idx },
          });
          await options.onWorkerTimeout?.(idx, items.length, items[idx], error);
        } else if (error instanceof CooperativeAsyncCancelledError || workerAbort.signal.aborted) {
          telemetry.workerStalled += 1;
          pushTelemetry(telemetry, {
            kind: "worker_stall",
            label: options.label,
            message: (error as Error).message,
            awaitMs,
            meta: { index: idx, cancelled: true },
          });
        } else {
          telemetry.workerStalled += 1;
          pushTelemetry(telemetry, {
            kind: "worker_stall",
            label: options.label,
            message: (error as Error).message,
            awaitMs,
            meta: { index: idx },
          });
        }
        logger.warn(
          { label: options.label, index: idx, error: (error as Error).message },
          "Cooperative worker isolated failure",
        );
        await options.onItemComplete?.(idx + 1, items.length, items[idx], null, error as Error);
        if (error instanceof RoundSelectionAbortError) {
          stopScheduling = true;
          throw error;
        }
      } finally {
        if (!workerAbort.signal.aborted) workerAbort.abort("worker complete");
        pushTelemetry(telemetry, {
          kind: "worker_complete",
          label: options.label,
          message: `worker done ${idx + 1}/${items.length}`,
          meta: { index: idx },
        });
      }
    }
  });

  const awaitRunners = Promise.allSettled(runners).then((settled) => {
    for (const result of settled) {
      if (result.status === "rejected" && isFatalCooperativeError(result.reason)) {
        throw result.reason;
      }
    }
  });

  if (stageDeadline) {
    await Promise.race([
      awaitRunners,
      sleep(Math.max(0, stageDeadline - Date.now())).then(() => {
        stopScheduling = true;
        poolAbort.abort("Stage watchdog timeout");
        telemetry.stageTimeouts += 1;
        pushTelemetry(telemetry, {
          kind: "stage_timeout",
          label: options.label,
          message: `Stage watchdog timeout for ${options.label}`,
        });
      }),
    ]);
  } else {
    await awaitRunners;
  }

  clearInterval(heartbeatTimer);
  if (budgetTimer) clearInterval(budgetTimer);
  if (!poolAbort.signal.aborted) poolAbort.abort("pool complete");
  return results;
}

export type RoundSelectionWatchdogHandle = { stop: () => void };

export function startRoundSelectionWatchdog(input: {
  jobId: string;
  getLastHeartbeatAt: () => string | undefined;
  getLastProgressAt?: () => string | undefined;
  getRuntimeSnapshot?: () => import("@/src/server/execution/round-runtime.types").RoundRuntimeSnapshot;
  selectionBudgetMs?: number;
  selectionStartedAt?: number;
  staleMs?: number;
  progressStaleMs?: number;
  pollMs?: number;
  onStale: (reason: string) => void;
  onProgressStale?: (reason: string) => void;
}): RoundSelectionWatchdogHandle {
  const staleMs = input.staleMs ?? resolveRoundWatchdogStaleMs();
  const pollMs = input.pollMs ?? resolveAsyncHeartbeatPollMs();
  let stopped = false;
  let staleReported = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const assessment = assessRoundProgressState({
      runtime: input.getRuntimeSnapshot?.() ?? null,
      selectionBudgetMs: input.selectionBudgetMs,
      selectionStartedAt: input.selectionStartedAt,
    });
    if (assessment.reasonCode === "SELECTION_BUDGET_EXCEEDED" && !staleReported) {
      staleReported = true;
      input.onStale(assessment.reasonDetail);
      return;
    }
    if (shouldBlockRecoveryRestart(assessment)) {
      return;
    }
    if (assessment.progressState === "STALLED" && !staleReported) {
      staleReported = true;
      const reason = assessment.reasonDetail;
      input.onProgressStale?.(reason);
      input.onStale(reason);
    }
  }, pollMs);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

export function summarizeAsyncTelemetry(telemetry: AsyncRuntimeTelemetry) {
  return {
    promiseStarted: telemetry.promiseStarted,
    promiseCompleted: telemetry.promiseCompleted,
    promiseTimedOut: telemetry.promiseTimedOut,
    promiseCancelled: telemetry.promiseCancelled,
    promiseFailed: telemetry.promiseFailed,
    workerStarted: telemetry.workerStarted,
    workerCompleted: telemetry.workerCompleted,
    workerStalled: telemetry.workerStalled,
    workerTimedOut: telemetry.workerTimedOut,
    stageTimeouts: telemetry.stageTimeouts,
    maxAwaitMs: telemetry.maxAwaitMs,
    recentEvents: telemetry.events.slice(-20),
  };
}
