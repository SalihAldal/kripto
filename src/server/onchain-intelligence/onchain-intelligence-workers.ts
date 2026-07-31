import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueOnChainIntelligenceJob, startOnChainIntelligenceQueue } from "@/src/server/onchain-intelligence/onchain-intelligence-queue";

type OnChainIntelligenceWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: OnChainIntelligenceWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureOnChainIntelligenceWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startOnChainIntelligenceQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `On-chain intelligence workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "BLOCKCHAIN_COLLECT", limit: 12 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "ADDRESS_ANALYZE", limit: 30 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "TX_METRICS", limit: 12 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "EXCHANGE_RESERVE", limit: 5 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "SUPPLY_TRACK", limit: 10 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "STAKING_TRACK", limit: 7 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "DEFI_TRACK", limit: 10 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "BRIDGE_TRACK", limit: 4 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "CONTRACT_TRACK", limit: 10 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "DEVELOPER_TRACK", limit: 10 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "PROTOCOL_HEALTH", limit: 10 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "ONCHAIN_SCORE", limit: 10 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "REPLAY_ANALYZE", limit: 15 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "METRIC_LEARN", limit: 200 }).catch(() => null), state.intervalMs * 5));
  timers.push(setInterval(() => void enqueueOnChainIntelligenceJob({ type: "KNOWLEDGE_BUILD", limit: 50 }).catch(() => null), state.intervalMs * 4));

  return state;
}

export function getOnChainIntelligenceWorkerState() {
  return { ...state };
}

export function stopOnChainIntelligenceWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
