import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import {
  enqueueLearningPlatformJob,
  startLearningPlatformQueue,
} from "@/src/server/learning-platform/learning-platform.queue";

type WorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
  lastError?: string;
  lastNightlyTrainAt?: string;
};

let timers: ReturnType<typeof setInterval>[] = [];
let nightlyTimer: ReturnType<typeof setTimeout> | null = null;
const state: WorkerState = {
  running: false,
  intervalMs: Math.max(120_000, env.SCANNER_WORKER_INTERVAL_MS * 2),
};

function scheduleNightlyTraining() {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), env.LEARNING_PLATFORM_NIGHTLY_TRAIN_HOUR_UTC, 0, 0));
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  const delay = target.getTime() - now.getTime();

  nightlyTimer = setTimeout(() => {
    void enqueueLearningPlatformJob({ type: "TRAIN_MODEL" }).catch((error) =>
      logger.warn({ error: (error as Error).message }, "Nightly training failed"),
    );
    state.lastNightlyTrainAt = new Date().toISOString();
    scheduleNightlyTraining();
  }, delay);
}

export function ensureLearningPlatformWorkersStarted() {
  if (!env.LEARNING_PLATFORM_ENABLED) return state;
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startLearningPlatformQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", "Learning Platform workers baslatildi.");

  timers.push(
    setInterval(() => {
      void enqueueLearningPlatformJob({ type: "DATASET_BUILD", limit: 200 }).catch(() => null);
    }, state.intervalMs * 3),
  );

  timers.push(
    setInterval(() => {
      void enqueueLearningPlatformJob({ type: "TRADE_MEMORY", limit: 30 }).catch(() => null);
    }, state.intervalMs),
  );

  timers.push(
    setInterval(() => {
      void enqueueLearningPlatformJob({ type: "COIN_LEARN", limit: 50 }).catch(() => null);
    }, state.intervalMs * 2),
  );

  timers.push(
    setInterval(() => {
      void enqueueLearningPlatformJob({ type: "MARKET_MEMORY" }).catch(() => null);
    }, state.intervalMs * 2),
  );

  timers.push(
    setInterval(() => {
      void enqueueLearningPlatformJob({ type: "MISSED_OPPORTUNITY", limit: 50 }).catch(() => null);
    }, state.intervalMs * 2),
  );

  timers.push(
    setInterval(() => {
      void enqueueLearningPlatformJob({ type: "PROMOTION_CANDIDATE" }).catch(() => null);
    }, state.intervalMs * 4),
  );

  timers.push(
    setInterval(() => {
      void enqueueLearningPlatformJob({ type: "DAILY_REPORT" }).catch(() => null);
    }, 24 * 60 * 60 * 1000),
  );

  scheduleNightlyTraining();

  return state;
}

export function getLearningPlatformWorkerState() {
  return { ...state };
}

export function stopLearningPlatformWorkers() {
  for (const t of timers) clearInterval(t);
  timers = [];
  if (nightlyTimer) clearTimeout(nightlyTimer);
  nightlyTimer = null;
  state.running = false;
}
