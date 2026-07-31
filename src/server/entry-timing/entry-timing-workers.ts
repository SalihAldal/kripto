import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueEntryTimingJob, startEntryTimingQueue } from "@/src/server/entry-timing/entry-timing-queue";

type EntryTimingWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: EntryTimingWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureEntryTimingWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startEntryTimingQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Entry timing workers baslatildi. interval=${state.intervalMs}ms`);

  const i = state.intervalMs;
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "ANALYZE_ENTRY" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "WAIT_REEVALUATE" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "FILTER_CHECK" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "CONFIRM_ENTRY" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "QUALITY_SCORE" }).catch(() => null), i * 3));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "REPLAY_ENTRY", limit: 10 }).catch(() => null), i * 6));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "LEARN_PATTERNS" }).catch(() => null), i * 8));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "HEATMAP_BUILD" }).catch(() => null), i * 12));
  timers.push(setInterval(() => void enqueueEntryTimingJob({ type: "RECOMMENDATION" }).catch(() => null), i * 2));

  return state;
}

export function getEntryTimingWorkerState() {
  return { ...state };
}

export function stopEntryTimingWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
