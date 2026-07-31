import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { enqueueShadowValidationJob, startShadowValidationQueue } from "@/src/server/shadow-validation/shadow-validation-queue";
import { ensureShadowEngineRegistrySeeded } from "@/src/server/shadow-validation/engine-registry.service";

type ShadowValidationWorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
};

let timers: ReturnType<typeof setInterval>[] = [];
const state: ShadowValidationWorkerState = {
  running: false,
  intervalMs: Math.max(30_000, env.SCANNER_WORKER_INTERVAL_MS),
};

export function ensureShadowValidationWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  void ensureShadowEngineRegistrySeeded();
  void import("@/src/server/shadow-validation/ab-test.service").then(({ ensureDefaultAbTests }) => ensureDefaultAbTests()).catch(() => null);
  void import("@/src/server/decision-engine-v2/decision-engine-v2.workers").then(({ ensureDecisionEngineV2WorkersStarted }) =>
    ensureDecisionEngineV2WorkersStarted(),
  ).catch(() => null);
  startShadowValidationQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Shadow validation workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(
    setInterval(() => {
      void enqueueShadowValidationJob({ type: "SHADOW_EVALUATE", limit: 40 }).catch((error) =>
        logger.warn({ error: (error as Error).message }, "Shadow evaluate enqueue failed"),
      );
    }, state.intervalMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueShadowValidationJob({ type: "REPLAY_VALIDATE", limit: 15 }).catch(() => null);
    }, state.intervalMs * 2),
  );
  timers.push(
    setInterval(() => {
      void enqueueShadowValidationJob({ type: "DAILY_COMPARISON" }).catch(() => null);
    }, 24 * 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueShadowValidationJob({ type: "WEEKLY_BENCHMARK" }).catch(() => null);
    }, 7 * 24 * 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueShadowValidationJob({ type: "MONTHLY_VALIDATION" }).catch(() => null);
    }, 30 * 24 * 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueShadowValidationJob({ type: "PROMOTION_CHECK" }).catch(() => null);
    }, 12 * 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueShadowValidationJob({ type: "SIMULATION_RUN", windowDays: 30 }).catch(() => null);
    }, 6 * 60 * 60 * 1000),
  );

  return state;
}

export function getShadowValidationWorkerState() {
  return { ...state };
}

export function stopShadowValidationWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
