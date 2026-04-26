import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { runScannerPipeline, toScannerApiRows } from "@/src/server/scanner/scanner.service";
import type { ScannerPipelineResult } from "@/src/types/scanner";

type ScannerWorkerState = {
  running: boolean;
  startedAt?: string;
  lastRunAt?: string;
  lastRunOk?: boolean;
  lastError?: string;
  intervalMs: number;
  lastResult?: ScannerPipelineResult;
  pausedUntil?: string;
};

let timer: ReturnType<typeof setInterval> | null = null;
let runLock = false;
const state: ScannerWorkerState = {
  running: false,
  intervalMs: env.SCANNER_WORKER_INTERVAL_MS,
};

async function tick() {
  if (runLock) return;
  if (state.pausedUntil && new Date(state.pausedUntil).getTime() > Date.now()) return;
  runLock = true;
  try {
    const result = await runScannerPipeline(undefined, {
      includeAi: env.SCANNER_WORKER_WITH_AI,
      persist: env.SCANNER_WORKER_PERSIST,
      persistRejected: false,
    });
    state.lastResult = result;
    state.lastRunOk = true;
    state.lastRunAt = new Date().toISOString();
    state.lastError = undefined;
    markHeartbeat({
      service: "scanner-worker",
      status: "UP",
      message: "Scanner worker tick completed",
      details: { intervalMs: state.intervalMs },
    });
  } catch (error) {
    state.lastRunOk = false;
    state.lastRunAt = new Date().toISOString();
    state.lastError = (error as Error).message;
    logger.warn({ error: state.lastError }, "Scanner worker tick failed");
    markHeartbeat({
      service: "scanner-worker",
      status: "DEGRADED",
      message: "Scanner worker tick failed",
      details: { error: state.lastError },
    });
  } finally {
    runLock = false;
  }
}

export function ensureScannerWorkerStarted() {
  if (!env.SCANNER_WORKER_ENABLED) return state;
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") return state;
  if (timer) return state;

  state.running = true;
  state.startedAt = new Date().toISOString();
  state.intervalMs = Math.max(3000, env.SCANNER_WORKER_INTERVAL_MS);
  pushLog("INFO", `Scanner worker baslatildi. interval=${state.intervalMs}ms`);
  void tick();
  timer = setInterval(() => {
    void tick();
  }, state.intervalMs);
  return state;
}

export function getScannerWorkerState() {
  return { ...state };
}

export function getScannerWorkerSnapshot() {
  const detailed = state.lastResult ?? null;
  return {
    detailed,
    rows: detailed ? toScannerApiRows(detailed) : [],
    updatedAt: state.lastRunAt ?? null,
  };
}

export function pauseScannerWorker(ms: number) {
  const until = new Date(Date.now() + Math.max(1_000, ms)).toISOString();
  state.pausedUntil = until;
  return until;
}

export function pauseScannerWorkerUntilResume() {
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  state.pausedUntil = until;
  return until;
}

export function resumeScannerWorker() {
  state.pausedUntil = undefined;
}

export function isScannerWorkerPaused() {
  if (!state.pausedUntil) return false;
  return new Date(state.pausedUntil).getTime() > Date.now();
}
