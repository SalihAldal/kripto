import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { enqueueDecisionEngineJob, startDecisionEngineQueue } from "@/src/server/decision-engine/decision-engine-queue";

type DecisionEngineWorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
};

let timers: ReturnType<typeof setInterval>[] = [];
const state: DecisionEngineWorkerState = {
  running: false,
  intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS * 3),
};

export function ensureDecisionEngineWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startDecisionEngineQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Decision engine workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(
    setInterval(() => {
      void enqueueDecisionEngineJob({ type: "WATCHLIST_RECHECK", limit: 20 }).catch((error) =>
        logger.warn({ error: (error as Error).message }, "Watchlist recheck enqueue failed"),
      );
    }, 5 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueDecisionEngineJob({ type: "EXPERT_REPLAY", limit: 10 }).catch(() => null);
    }, state.intervalMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueDecisionEngineJob({ type: "EXPERT_PERFORMANCE", periodDays: 7 }).catch(() => null);
    }, 6 * 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueDecisionEngineJob({ type: "WEIGHT_RECOMMENDATION" }).catch(() => null);
    }, 12 * 60 * 60 * 1000),
  );

  return state;
}

export function getDecisionEngineWorkerState() {
  return { ...state };
}

export function stopDecisionEngineWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
