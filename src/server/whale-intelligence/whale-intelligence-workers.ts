import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueWhaleIntelligenceJob, startWhaleIntelligenceQueue } from "@/src/server/whale-intelligence/whale-intelligence-queue";

type WhaleIntelligenceWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: WhaleIntelligenceWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureWhaleIntelligenceWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startWhaleIntelligenceQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Whale intelligence workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "WHALE_DETECT", limit: 15 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "WALLET_MONITOR", limit: 20 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "EXCHANGE_FLOW", limit: 7 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "STABLECOIN_FLOW", limit: 8 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "FLOW_CALCULATE", limit: 100 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "WHALE_SCORE", limit: 20 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "LIQUIDITY_ROTATION", limit: 5 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "PATTERN_DETECT", limit: 30 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "REPLAY_ANALYZE", limit: 20 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "INSTITUTIONAL_LEARN", limit: 200 }).catch(() => null), state.intervalMs * 5));
  timers.push(setInterval(() => void enqueueWhaleIntelligenceJob({ type: "ALERT_GENERATE", limit: 50 }).catch(() => null), state.intervalMs));

  return state;
}

export function getWhaleIntelligenceWorkerState() {
  return { ...state };
}

export function stopWhaleIntelligenceWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
