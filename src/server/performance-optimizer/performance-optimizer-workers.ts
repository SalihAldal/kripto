import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueuePerfOptJob, startPerfOptQueue } from "@/src/server/performance-optimizer/performance-optimizer-queue";

type PerfOptWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: PerfOptWorkerState = { running: false, intervalMs: Math.max(120_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensurePerfOptWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startPerfOptQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Performance optimizer workers baslatildi. interval=${state.intervalMs}ms`);

  const i = state.intervalMs;
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "DAILY_REVIEW" }).catch(() => null), i * 24));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "TRADE_ANALYZE", limit: 20 }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "MISSED_OPPORTUNITY", limit: 15 }).catch(() => null), i * 3));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "STRATEGY_RANKING" }).catch(() => null), i * 4));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "COIN_RANKING" }).catch(() => null), i * 4));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "GENERATE_RECOMMENDATIONS" }).catch(() => null), i * 6));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "TIMELINE_UPDATE", period: "DAILY" }).catch(() => null), i * 8));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "SUCCESS_METRICS" }).catch(() => null), i * 10));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "MARKET_CONDITION_ANALYZE" }).catch(() => null), i * 5));
  timers.push(setInterval(() => void enqueuePerfOptJob({ type: "PAPER_LIVE_COMPARE" }).catch(() => null), i * 12));

  return state;
}

export function getPerfOptWorkerState() {
  return { ...state };
}

export function stopPerfOptWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
