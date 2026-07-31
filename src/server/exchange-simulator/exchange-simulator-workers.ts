import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueExchangeSimulatorJob, startExchangeSimulatorQueue } from "@/src/server/exchange-simulator/exchange-simulator-queue";

type WorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: WorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureExchangeSimulatorWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startExchangeSimulatorQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", "Exchange simulator workers baslatildi.");

  timers.push(setInterval(() => void enqueueExchangeSimulatorJob({ type: "EXECUTION_SIMULATE", limit: 30 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueExchangeSimulatorJob({ type: "EXECUTION_REPLAY", limit: 30 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueExchangeSimulatorJob({ type: "SLIPPAGE_CALCULATE", periodHours: 24 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueExchangeSimulatorJob({ type: "LATENCY_ANALYZE", periodHours: 24 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueExchangeSimulatorJob({ type: "FEE_CALCULATE", periodHours: 24 }).catch(() => null), 60 * 60 * 1000));

  return state;
}

export function getExchangeSimulatorWorkerState() {
  return { ...state };
}
