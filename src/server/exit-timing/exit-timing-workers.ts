import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueExitTimingJob, startExitTimingQueue } from "@/src/server/exit-timing/exit-timing-queue";

type ExitTimingWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: ExitTimingWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureExitTimingWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startExitTimingQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Exit timing workers baslatildi. interval=${state.intervalMs}ms`);

  const i = state.intervalMs;
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "POSITION_SCAN" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "PROFIT_PROTECTION" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "HOLD_REEVALUATE" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "ANALYZE_EXIT" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "EXIT_SCORE" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "RECOMMENDATION" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "EXIT_QUALITY" }).catch(() => null), i * 3));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "REPLAY_EXIT", limit: 10 }).catch(() => null), i * 6));
  timers.push(setInterval(() => void enqueueExitTimingJob({ type: "LEARN_EXITS" }).catch(() => null), i * 8));

  return state;
}

export function getExitTimingWorkerState() {
  return { ...state };
}

export function stopExitTimingWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
