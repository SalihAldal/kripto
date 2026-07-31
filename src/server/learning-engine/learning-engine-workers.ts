import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { enqueueLearningEngineJob, startLearningEngineQueue } from "@/src/server/learning-engine/learning-engine-queue";

type LearningEngineWorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
};

let timers: ReturnType<typeof setInterval>[] = [];
const state: LearningEngineWorkerState = {
  running: false,
  intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS),
};

export function ensureLearningEngineWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startLearningEngineQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Learning engine workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "DECISION_LEARN", limit: 25 }).catch(() => null);
    }, state.intervalMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "TRADE_LEARN", limit: 25 }).catch(() => null);
    }, state.intervalMs),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "REJECT_LEARN", limit: 50 }).catch(() => null);
    }, state.intervalMs * 2),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "MISSED_OPPORTUNITY_LEARN", limit: 50 }).catch(() => null);
    }, state.intervalMs * 2),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "FALSE_POSITIVE_LEARN", limit: 50 }).catch(() => null);
    }, state.intervalMs * 2),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "PATTERN_DISCOVERY", limit: 200 }).catch(() => null);
    }, state.intervalMs * 3),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "FEATURE_IMPORTANCE", periodHours: 24 * 30 }).catch(() => null);
    }, state.intervalMs * 4),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "WEIGHT_RECOMMENDATION" }).catch(() => null);
    }, state.intervalMs * 6),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "KNOWLEDGE_BUILD", limit: 100 }).catch(() => null);
    }, state.intervalMs * 4),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "CONFIDENCE_CALIBRATION", periodHours: 24 * 30 }).catch(() => null);
    }, state.intervalMs * 6),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "MEMORY_SYNC" }).catch(() => null);
    }, state.intervalMs * 5),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "DAILY_AI_REPORT" }).catch((error) =>
        logger.warn({ error: (error as Error).message }, "Daily AI report enqueue failed"),
      );
    }, 24 * 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "WEEKLY_RESEARCH" }).catch(() => null);
    }, 7 * 24 * 60 * 60 * 1000),
  );
  timers.push(
    setInterval(() => {
      void enqueueLearningEngineJob({ type: "RESEARCH_LAB" }).catch(() => null);
    }, 12 * 60 * 60 * 1000),
  );

  return state;
}

export function getLearningEngineWorkerState() {
  return { ...state };
}

export function stopLearningEngineWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
