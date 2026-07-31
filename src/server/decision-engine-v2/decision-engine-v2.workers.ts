import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import {
  enqueueDecisionEngineV2Job,
  startDecisionEngineV2Queue,
} from "@/src/server/decision-engine-v2/decision-engine-v2.queue";
import { ensureModelRegistryInitialized } from "@/src/server/decision-engine-v2/model-registry.service";

type DecisionEngineV2WorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
  lastError?: string;
};

let timers: ReturnType<typeof setInterval>[] = [];
let runLock = false;
const state: DecisionEngineV2WorkerState = {
  running: false,
  intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS * 2),
};

async function guardedEnqueue(label: string, fn: () => Promise<unknown>) {
  if (runLock) return;
  runLock = true;
  try {
    await fn();
    state.lastError = undefined;
    markHeartbeat({ service: "decision-engine-v2", status: "UP", message: `${label} completed` });
  } catch (error) {
    state.lastError = (error as Error).message;
    logger.warn({ error: state.lastError, label }, "Decision Engine V2 worker job failed");
    markHeartbeat({ service: "decision-engine-v2", status: "DEGRADED", message: state.lastError });
  } finally {
    runLock = false;
  }
}

export function ensureDecisionEngineV2WorkersStarted() {
  if (!env.DECISION_ENGINE_V2_ENABLED) return state;
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startDecisionEngineV2Queue();
  void ensureModelRegistryInitialized().catch(() => null);
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Decision Engine V2 workers baslatildi. interval=${state.intervalMs}ms`);

  void guardedEnqueue("REGISTRY_SYNC", async () => {
    await enqueueDecisionEngineV2Job({ type: "REGISTRY_SYNC" });
  });

  timers.push(
    setInterval(() => {
      void guardedEnqueue("PREDICTION_BATCH", async () => {
        await enqueueDecisionEngineV2Job({ type: "PREDICTION_BATCH", limit: 15 });
      });
    }, state.intervalMs),
  );

  timers.push(
    setInterval(() => {
      void guardedEnqueue("SHADOW_PERFORMANCE", async () => {
        await enqueueDecisionEngineV2Job({ type: "SHADOW_PERFORMANCE", days: 30 });
      });
    }, state.intervalMs * 2),
  );

  timers.push(
    setInterval(() => {
      void guardedEnqueue("PROMOTION_CHECK", async () => {
        await enqueueDecisionEngineV2Job({ type: "PROMOTION_CHECK" });
      });
    }, state.intervalMs * 6),
  );

  timers.push(
    setInterval(() => {
      void guardedEnqueue("MODEL_TRAIN", async () => {
        await enqueueDecisionEngineV2Job({ type: "MODEL_TRAIN", limit: env.DECISION_ENGINE_V2_TRAINING_LIMIT });
      });
    }, 24 * 60 * 60 * 1000),
  );

  timers.push(
    setInterval(() => {
      void guardedEnqueue("FEATURE_IMPORTANCE", async () => {
        await enqueueDecisionEngineV2Job({ type: "FEATURE_IMPORTANCE" });
      });
    }, state.intervalMs * 4),
  );

  return state;
}

export function getDecisionEngineV2WorkerState() {
  return { ...state };
}

export function stopDecisionEngineV2Workers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
