import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import {
  enqueueExecutionEngineV2Job,
  startExecutionEngineV2Queue,
} from "@/src/server/execution-engine-v2/execution-engine-v2.queue";
import { clearExpiredIdempotencyKeys } from "@/src/server/execution-engine-v2/idempotency.service";

type WorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
  lastError?: string;
};

let timers: ReturnType<typeof setInterval>[] = [];
const state: WorkerState = {
  running: false,
  intervalMs: Math.max(30_000, env.SCANNER_WORKER_INTERVAL_MS),
};

export function ensureExecutionEngineV2WorkersStarted() {
  if (!env.EXECUTION_ENGINE_V2_ENABLED) return state;
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startExecutionEngineV2Queue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Execution Engine V2 workers baslatildi.`);

  timers.push(
    setInterval(() => {
      void enqueueExecutionEngineV2Job({ type: "RECOVERY" }).catch(() => null);
    }, state.intervalMs),
  );

  timers.push(
    setInterval(() => {
      void enqueueExecutionEngineV2Job({ type: "RECONCILE" }).catch((error) =>
        logger.warn({ error: (error as Error).message }, "Reconciliation failed"),
      );
    }, env.EXECUTION_ENGINE_V2_RECONCILE_INTERVAL_MS),
  );

  timers.push(
    setInterval(() => {
      void enqueueExecutionEngineV2Job({ type: "HOLD_REEVALUATE" }).catch(() => null);
    }, state.intervalMs * 2),
  );

  timers.push(
    setInterval(() => {
      void enqueueExecutionEngineV2Job({ type: "WAIT_REEVALUATE" }).catch(() => null);
    }, state.intervalMs * 2),
  );

  timers.push(
    setInterval(() => clearExpiredIdempotencyKeys(), state.intervalMs * 4),
  );

  return state;
}

export function getExecutionEngineV2WorkerState() {
  return { ...state };
}

export function stopExecutionEngineV2Workers() {
  for (const t of timers) clearInterval(t);
  timers = [];
  state.running = false;
}
