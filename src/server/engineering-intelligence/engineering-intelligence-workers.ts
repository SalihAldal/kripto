import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueEngineeringIntelligenceJob, startEngineeringIntelligenceQueue } from "@/src/server/engineering-intelligence/engineering-intelligence-queue";

type EngineeringIntelligenceWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: EngineeringIntelligenceWorkerState = { running: false, intervalMs: Math.max(120_000, env.SCANNER_WORKER_INTERVAL_MS * 2) };

export function ensureEngineeringIntelligenceWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startEngineeringIntelligenceQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Engineering intelligence workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "DAILY_AUDIT" }).catch(() => null), state.intervalMs * 12));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "WEEKLY_AUDIT" }).catch(() => null), state.intervalMs * 84));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "ARCHITECTURE_SCAN", limit: 30 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "CODE_QUALITY_SCAN", limit: 80 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "PERFORMANCE_SCAN", limit: 30 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "SECURITY_SCAN", limit: 100 }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "DATABASE_SCAN", limit: 50 }).catch(() => null), state.intervalMs * 8));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "QUEUE_SCAN", limit: 15 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "API_SCAN", limit: 80 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "DEPENDENCY_SCAN", limit: 100 }).catch(() => null), state.intervalMs * 12));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "AI_USAGE_SCAN", limit: 50 }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "HEALTH_SCORE", reportType: "DAILY" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueEngineeringIntelligenceJob({ type: "REFACTORING_ADVISE", limit: 30 }).catch(() => null), state.intervalMs * 8));

  return state;
}

export function getEngineeringIntelligenceWorkerState() {
  return { ...state };
}

export function stopEngineeringIntelligenceWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
