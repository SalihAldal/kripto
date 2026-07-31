import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueMetaIntelligenceJob, startMetaIntelligenceQueue } from "@/src/server/meta-intelligence/meta-intelligence-queue";

type MetaIntelligenceWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: MetaIntelligenceWorkerState = { running: false, intervalMs: Math.max(120_000, env.SCANNER_WORKER_INTERVAL_MS * 2) };

export function ensureMetaIntelligenceWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startMetaIntelligenceQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Meta intelligence workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "CONTEXT_BUILD" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "CONTEXT_FUSION" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "CONFLICT_RESOLVE" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "EXECUTIVE_REASON" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "NARRATIVE_BUILD", limit: 5 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "PRIORITY_RANK", limit: 30 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "COMMITTEE_MEET" }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "EXECUTIVE_REPORT", reportType: "DAILY_EXECUTIVE" }).catch(() => null), state.intervalMs * 12));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "EXECUTIVE_LEARN", limit: 20 }).catch(() => null), state.intervalMs * 8));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "KNOWLEDGE_BUILD", limit: 50 }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "KPI_TRACK" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "STRATEGIC_OBJECTIVES" }).catch(() => null), state.intervalMs * 8));
  timers.push(setInterval(() => void enqueueMetaIntelligenceJob({ type: "FUTURE_PLAN" }).catch(() => null), state.intervalMs * 12));

  return state;
}

export function getMetaIntelligenceWorkerState() {
  return { ...state };
}

export function stopMetaIntelligenceWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
