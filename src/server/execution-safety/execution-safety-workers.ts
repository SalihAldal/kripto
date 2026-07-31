import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueExecutionSafetyJob, startExecutionSafetyQueue } from "@/src/server/execution-safety/execution-safety-queue";

type WorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: WorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureExecutionSafetyWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startExecutionSafetyQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", "Execution safety workers baslatildi.");

  timers.push(setInterval(() => void enqueueExecutionSafetyJob({ type: "EXECUTION_VALIDATE" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueExecutionSafetyJob({ type: "EXCHANGE_HEALTH_MONITOR" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueExecutionSafetyJob({ type: "API_HEALTH_CHECK" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueExecutionSafetyJob({ type: "DUPLICATE_DETECT" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueExecutionSafetyJob({ type: "EMERGENCY_MONITOR" }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueExecutionSafetyJob({ type: "RECOVERY_PROCESS" }).catch(() => null), state.intervalMs * 5));

  return state;
}

export function getExecutionSafetyWorkerState() {
  return { ...state };
}
