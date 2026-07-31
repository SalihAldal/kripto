import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueNewsIntelligenceJob, startNewsIntelligenceQueue } from "@/src/server/news-intelligence/news-intelligence-queue";

type NewsIntelligenceWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: NewsIntelligenceWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureNewsIntelligenceWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startNewsIntelligenceQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `News intelligence workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "NEWS_COLLECT", limit: 15 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "RSS_COLLECT", limit: 10 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "TWITTER_COLLECT", limit: 10 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "TELEGRAM_COLLECT", limit: 10 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "GITHUB_COLLECT", limit: 5 }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "CLASSIFY", limit: 30 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "NARRATIVE_DETECT", limit: 100 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "IMPACT_SCORE", limit: 30 }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "DUPLICATE_DETECT", limit: 50 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "SENTIMENT_ANALYZE", limit: 30 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "COIN_MAP", limit: 30 }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "REPLAY_ANALYZE", limit: 20 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "NEWS_LEARN", limit: 200 }).catch(() => null), state.intervalMs * 5));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "TIMELINE_SYNC" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueNewsIntelligenceJob({ type: "SOURCE_SCORE" }).catch(() => null), state.intervalMs * 4));

  return state;
}

export function getNewsIntelligenceWorkerState() {
  return { ...state };
}

export function stopNewsIntelligenceWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
