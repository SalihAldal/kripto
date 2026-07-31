import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueAocJob, startAocQueue } from "@/src/server/aoc/aoc-queue";

type AocWorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: AocWorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureAocWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startAocQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `AOC workers baslatildi. interval=${state.intervalMs}ms`);

  const i = state.intervalMs;
  timers.push(setInterval(() => void enqueueAocJob({ type: "PLATFORM_HEALTH" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueAocJob({ type: "TRADING_HEALTH" }).catch(() => null), i));
  timers.push(setInterval(() => void enqueueAocJob({ type: "INFRASTRUCTURE_MONITOR" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueAocJob({ type: "EXCHANGE_MONITOR" }).catch(() => null), i * 2));
  timers.push(setInterval(() => void enqueueAocJob({ type: "QUEUE_MONITOR" }).catch(() => null), i * 3));
  timers.push(setInterval(() => void enqueueAocJob({ type: "KPI_MONITOR" }).catch(() => null), i * 4));
  timers.push(setInterval(() => void enqueueAocJob({ type: "AI_HEALTH" }).catch(() => null), i * 4));
  timers.push(setInterval(() => void enqueueAocJob({ type: "ANOMALY_DETECT" }).catch(() => null), i * 5));
  timers.push(setInterval(() => void enqueueAocJob({ type: "SELF_HEAL" }).catch(() => null), i * 6));
  timers.push(setInterval(() => void enqueueAocJob({ type: "ALERT_DISPATCH" }).catch(() => null), i * 3));
  timers.push(setInterval(() => void enqueueAocJob({ type: "INCIDENT_PROCESS" }).catch(() => null), i * 4));
  timers.push(setInterval(() => void enqueueAocJob({ type: "HEALTH_SCORES" }).catch(() => null), i * 5));
  timers.push(setInterval(() => void enqueueAocJob({ type: "DEPENDENCY_MAP" }).catch(() => null), i * 24));

  return state;
}

export function getAocWorkerState() {
  return { ...state };
}

export function stopAocWorkers() {
  for (const timer of timers) clearInterval(timer);
  timers = [];
  state.running = false;
}
