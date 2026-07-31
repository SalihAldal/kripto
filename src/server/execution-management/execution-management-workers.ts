import { env } from "@/lib/config";
import { pushLog } from "@/services/log.service";
import { enqueueExecutionMgmtJob, startExecutionMgmtQueue } from "@/src/server/execution-management/execution-management-queue";

type WorkerState = { running: boolean; startedAt?: string; intervalMs: number };
let timers: ReturnType<typeof setInterval>[] = [];
const state: WorkerState = { running: false, intervalMs: Math.max(60_000, env.SCANNER_WORKER_INTERVAL_MS) };

export function ensureExecutionMgmtWorkersStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (state.running) return state;

  startExecutionMgmtQueue();
  state.running = true;
  state.startedAt = new Date().toISOString();
  pushLog("INFO", `Execution management workers baslatildi.`);

  timers.push(setInterval(() => void enqueueExecutionMgmtJob({ type: "POSITION_SYNC" }).catch(() => null), state.intervalMs));
  timers.push(setInterval(() => void enqueueExecutionMgmtJob({ type: "PORTFOLIO_SNAPSHOT" }).catch(() => null), state.intervalMs * 2));
  timers.push(setInterval(() => void enqueueExecutionMgmtJob({ type: "EXECUTION_REPLAY", limit: 20 }).catch(() => null), state.intervalMs * 3));
  timers.push(setInterval(() => void enqueueExecutionMgmtJob({ type: "STATISTICS_AGGREGATE", periodHours: 24 }).catch(() => null), 60 * 60 * 1000));

  return state;
}

export function getExecutionMgmtWorkerState() {
  return { ...state };
}
