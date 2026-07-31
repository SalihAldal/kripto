import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueAiGovernanceJob, startAiGovernanceQueue } from "@/src/server/ai-governance/ai-governance-queue";

type AiGovernanceWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: AiGovernanceWorkerState = { running: false, intervalMs: Math.max(120_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureAiGovernanceWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startAiGovernanceQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `AI governance workers baslatildi. interval=${state.intervalMs}ms`);

  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "DEPLOYMENT_PROCESS" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "ROLLBACK_CHECK" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "APPROVAL_PROCESS" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "HEALTH_MONITOR" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "GOVERNANCE_MONITOR" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "AUDIT_SYNC", limit: 200 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "CANARY_EVALUATE" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "SHADOW_EVALUATE" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "FEATURE_FLAG_SYNC" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "CONFIG_VALIDATE" }).catch(() => null), state.intervalMs * 4));
  timers.push(setInterval(() => void enqueueAiGovernanceJob({ type: "PROMOTION_EVALUATE" }).catch(() => null), state.intervalMs * 5));

  return state;
}

export function getAiGovernanceWorkerState() {
  return { ...state };
}

export function stopAiGovernanceWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
