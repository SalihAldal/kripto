import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { runScannerPipeline, toScannerApiRows } from "@/src/server/scanner/scanner.service";
import { getPumpEarlyCatcherState } from "@/src/server/scanner/pump-early-catcher.service";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import {
  getShadowOutcomeEngine,
  observeCanonicalShadowTick,
} from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { persistShadowOutcomes } from "@/src/server/shadow-outcome/persist";
import type { ScannerPipelineResult } from "@/src/types/scanner";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";

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
let opportunityTimer: ReturnType<typeof setInterval> | null = null;
let runLock = false;
const state: ScannerWorkerState = {
  running: false,
  intervalMs: env.SCANNER_WORKER_INTERVAL_MS,
};

async function tickOpportunity() {
  try {
    const opportunity = getOpportunityEngine().scan();
    const micro = getMicrostructureEngine().evaluate(opportunity.ranked);
    observeCanonicalShadowTick({
      opportunity: opportunity.ranked,
      micro: micro.ranked,
      snapshots: getMarketDataDaemon().getMarketSnapshot(),
    });
    void persistShadowOutcomes();
  } catch (error) {
    logger.warn({ error: (error as Error).message }, "Opportunity/microstructure/shadow scan failed");
  }
}

function buildCanonicalScannerSnapshot(): ScannerPipelineResult {
  const opportunity = getOpportunityEngine().getLastResult();
  const micro = getMicrostructureEngine().getExecutionReady();
  const microCandidates = getMicrostructureEngine().toScannerCandidates();
  const fallbackOpportunityCandidates = getOpportunityEngine().toScannerCandidates().slice(0, 20);
  const selectedCandidates = microCandidates.length > 0 ? microCandidates : fallbackOpportunityCandidates;
  return {
    scannedAt: new Date().toISOString(),
    totalSymbols: opportunity?.universeSize ?? 0,
    qualifiedSymbols: selectedCandidates.filter((row) => row.score.status === "QUALIFIED").length,
    aiEvaluatedSymbols: selectedCandidates.filter((row) => Boolean(row.ai)).length,
    candidates: selectedCandidates,
    coverage: {
      scannerUniverse: opportunity?.universeSize ?? 0,
      rotationCandidates: opportunity?.evaluated ?? 0,
      priorityCandidates: opportunity?.ranked.length ?? 0,
      duplicatesRemoved: 0,
      totalEvaluated: opportunity?.evaluated ?? 0,
      notDiscoveredCount: Math.max(0, (opportunity?.evaluated ?? 0) - selectedCandidates.length),
      priorityRescuedCount: micro.length,
      discoverySources: selectedCandidates.map((row) => ({
        symbol: row.context.symbol.toUpperCase(),
        discoverySource: "PRIORITY" as const,
        prioritySource: "OPPORTUNITY_ENGINE",
      })),
    },
  };
}

async function tick() {
  if (runLock) return;
  if (state.pausedUntil && new Date(state.pausedUntil).getTime() > Date.now()) return;
  runLock = true;
  try {
    const useLegacyPipeline = String(process.env.SCANNER_WORKER_USE_LEGACY_PIPELINE ?? "").toLowerCase() === "true";
    const result = useLegacyPipeline
      ? await runScannerPipeline(undefined, {
          includeAi: env.SCANNER_WORKER_WITH_AI,
          persist: false,
          persistRejected: false,
        })
      : buildCanonicalScannerSnapshot();
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
  void tickOpportunity();
  opportunityTimer = setInterval(() => {
    void tickOpportunity();
  }, 1_000);
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
    pumpEarlyCatcher: getPumpEarlyCatcherState(),
    opportunity: getOpportunityEngine().getTelemetry(),
    microstructure: getMicrostructureEngine().getTelemetry(),
    candidateStore: getCanonicalCandidateStore().getTelemetry(),
    shadowOutcome: getShadowOutcomeEngine().getTelemetry(),
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
