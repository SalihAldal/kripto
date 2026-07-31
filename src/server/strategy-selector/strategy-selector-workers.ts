import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueStrategySelectorJob, startStrategySelectorQueue } from "@/src/server/strategy-selector/strategy-selector-queue";
import { ensureStrategyProfiles } from "@/src/server/strategy-selector/strategy-profile-bootstrap.service";

type StrategySelectorWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: StrategySelectorWorkerState = { running: false, intervalMs: Math.max(90_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureStrategySelectorWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startStrategySelectorQueue();
  void ensureStrategyProfiles();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Strategy selector workers baslatildi. interval=${state.intervalMs}ms`);

  const i = state.intervalMs;
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "DETECT_REGIME" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "SELECT_STRATEGY", symbol: "BTCUSDT" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "SWITCH_CHECK" }).catch(() => null), i * 3));
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "BENCHMARK_STRATEGIES" }).catch(() => null), i * 6));
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "REPLAY_STRATEGY", limit: 10 }).catch(() => null), i * 8));
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "LEARN_STRATEGIES" }).catch(() => null), i * 10));
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "UPDATE_KNOWLEDGE" }).catch(() => null), i * 12));
  timers.push(setInterval(() => void enqueueStrategySelectorJob({ type: "PERFORMANCE_SYNC" }).catch(() => null), i * 4));

  return state;
}

export function getStrategySelectorWorkerState() {
  return { ...state };
}

export function stopStrategySelectorWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
