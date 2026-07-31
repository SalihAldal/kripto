import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import {
  enqueueLiveTradingJob,
  startLiveTradingQueue,
} from "@/src/server/live-trading/live-trading.queue";

type WorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
};

let timers: ReturnType<typeof setInterval>[] = [];
const state: WorkerState = {
  running: false,
  intervalMs: Math.max(30_000, env.LIVE_TRADING_HEALTH_INTERVAL_MS),
};

export function ensureLiveTradingWorkersStarted() {
  if (!env.LIVE_TRADING_PLATFORM_ENABLED) return state;
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startLiveTradingQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Live trading workers baslatildi. interval=${state.intervalMs}ms`);

  const reconcileMs = Math.max(60_000, env.LIVE_TRADING_RECONCILE_INTERVAL_MS);

  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "HEALTH_MONITOR" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "CIRCUIT_BREAKER_CHECK" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "KILL_SWITCH_MONITOR" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "RECONCILIATION" }).catch(() => null), reconcileMs));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "EXECUTION_AUDIT", limit: 50 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "ALERT_DISPATCH", limit: 50 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "POSITION_RECOVERY" }).catch(() => null), reconcileMs * 2));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "GO_LIVE_VALIDATE" }).catch(() => null), state.intervalMs * 10));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "PRODUCTION_REPORT", cadence: "DAILY" }).catch(() => null), 24 * 60 * 60 * 1000));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "PRODUCTION_REPORT", cadence: "WEEKLY" }).catch(() => null), 7 * 24 * 60 * 60 * 1000));
  timers.push(setInterval(() => void enqueueLiveTradingJob({ type: "PRODUCTION_REPORT", cadence: "MONTHLY" }).catch(() => null), 30 * 24 * 60 * 60 * 1000));

  void enqueueLiveTradingJob({ type: "POSITION_RECOVERY" }).catch(() => null);

  return state;
}

export function getLiveTradingWorkerState() {
  return { ...state };
}

export function stopLiveTradingWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
