import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { ensurePaperValidationEventBridge } from "@/src/server/paper-validation/paper-validation-events.service";
import {
  enqueuePaperValidationJob,
  startPaperValidationQueue,
} from "@/src/server/paper-validation/paper-validation.queue";

type WorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
};

let timers: ReturnType<typeof setInterval>[] = [];
const state: WorkerState = {
  running: false,
  intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS),
};

export function ensurePaperValidationWorkersStarted() {
  if (!env.PAPER_VALIDATION_PLATFORM_ENABLED) return state;
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  ensurePaperValidationEventBridge();
  startPaperValidationQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Paper validation workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "SYNC_PORTFOLIO" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "RECORD_TRADES", limit: 50 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "CALCULATE_METRICS" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "COIN_RANKING" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "SESSION_ANALYSIS" }).catch(() => null), state.intervalMs * 5));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "MISSED_OPPORTUNITY", limit: 50 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "ACCURACY_CHECK", limit: 100 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "RISK_VALIDATION" }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "READINESS_SCORE" }).catch(() => null), state.intervalMs * 8));
  timers.push(setInterval(() => void enqueuePaperValidationJob({ type: "DAILY_REPORT" }).catch(() => null), 24 * 60 * 60 * 1000));

  return state;
}

export function getPaperValidationWorkerState() {
  return { ...state };
}

export function stopPaperValidationWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
