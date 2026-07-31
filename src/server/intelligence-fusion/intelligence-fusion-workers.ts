import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueIntelligenceFusionJob, startIntelligenceFusionQueue } from "@/src/server/intelligence-fusion/intelligence-fusion-queue";

type IntelligenceFusionWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: IntelligenceFusionWorkerState = { running: false, intervalMs: Math.max(90_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureIntelligenceFusionWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startIntelligenceFusionQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Intelligence fusion workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "FUSION_PIPELINE" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "CONFLICT_RESOLVE" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "SOURCE_RELIABILITY" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "NARRATIVE_BUILD" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "EVIDENCE_COLLECT" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "FUSION_REPLAY", limit: 10 }).catch(() => null), state.intervalMs * 8));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "QUALITY_SCORE" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "KNOWLEDGE_INTEGRATE" }).catch(() => null), state.intervalMs * 6));
  timers.push(setInterval(() => void enqueueIntelligenceFusionJob({ type: "VALIDATE_PUBLISH" }).catch(() => null), state.intervalMs * 2));

  return state;
}

export function getIntelligenceFusionWorkerState() {
  return { ...state };
}

export function stopIntelligenceFusionWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
