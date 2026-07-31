import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueQuantResearchJob, startQuantResearchQueue } from "@/src/server/quant-research/quant-research-queue";
type QuantResearchWorkerState = {
  running: boolean;
  startedAt?: string;
  intervalMs: number;
};

let timers: ReturnType<typeof setInterval>[] = [];
const state: QuantResearchWorkerState = {
  running: false,
  intervalMs: Math.max(120_000, env.SCANNER_WORKER_INTERVAL_MS),
};

export function ensureQuantResearchWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (!env.QUANT_RESEARCH_PLATFORM_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;  if (state.running) return state;

  startQuantResearchQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Quant research workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "STRATEGY_GENERATE", count: 5 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "INDICATOR_GENERATE", count: 20 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "BACKTEST", windowDays: 90 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "WALK_FORWARD", folds: 5 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "MONTE_CARLO", iterations: 500 }).catch(() => null), state.intervalMs * 5));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "REGIME_BENCHMARK" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "STRATEGY_COMPETITION" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "STRATEGY_EVOLVE" }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "FEATURE_SELECT" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "INSTITUTIONAL_BENCHMARK" }).catch(() => null), state.intervalMs * 5));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "KNOWLEDGE_SYNC", limit: 50 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "SELF_DISCOVERY" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "RESEARCH_REPORT", cadence: "DAILY" }).catch(() => null), 24 * 60 * 60 * 1000));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "RESEARCH_REPORT", cadence: "WEEKLY" }).catch(() => null), 7 * 24 * 60 * 60 * 1000));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "RESEARCH_REPORT", cadence: "MONTHLY" }).catch(() => null), 30 * 24 * 60 * 60 * 1000));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "RESEARCH_RUN", windowDays: 90 }).catch(() => null), state.intervalMs * 8));

  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "EXPERIMENT_RUN", windowDays: 90 }).catch(() => null), state.intervalMs * 10));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "COUNTERFACTUAL_ANALYZE", limit: 50 }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "WALK_FORWARD_VALIDATE", folds: 5 }).catch(() => null), state.intervalMs * 7));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "STRATEGY_BENCHMARK", windowDays: 90 }).catch(() => null), state.intervalMs * 5));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "FEATURE_RESEARCH", windowDays: 90 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "FEATURE_ELIMINATE", windowDays: 90 }).catch(() => null), state.intervalMs * 8));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "STATISTICAL_VALIDATE", windowDays: 90 }).catch(() => null), state.intervalMs * 9));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "HYPOTHESIS_GENERATE", limit: 5 }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueQuantResearchJob({ type: "RECOMMENDATION_GENERATE" }).catch(() => null), state.intervalMs * 12));

  return state;
}
export function getQuantResearchWorkerState() {
  return { ...state };
}

export function stopQuantResearchWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
