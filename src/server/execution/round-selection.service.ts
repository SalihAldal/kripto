import { env } from "@/lib/config";
import { getBestFastEntry, getPumpFastEntry, type FastEntryRuntimeHooks } from "@/src/server/scanner";
import type { ScannerCandidate } from "@/src/types/scanner";
import {
  cancelRoundSelection,
  getRoundCancellationSignal,
  RoundRuntimeController,
  registerRoundCancellation,
  startSelectionBudgetEnforcer,
} from "@/src/server/execution/round-runtime.service";
import { RoundSelectionAbortError } from "@/src/server/execution/round-runtime.types";
import { terminalizeOpenAiCandidates } from "@/src/server/forensics/ai-runtime.service";
import { PumpScanFailedError, recordPumpScanEvent } from "@/src/server/scanner/pump-scan-lifecycle.service";
import { traceCandidateFailed, traceCandidateReject, traceCandidateWait } from "@/src/server/forensics/candidate-lifecycle.service";
import {
  createAsyncTelemetry,
  startRoundSelectionWatchdog,
  summarizeAsyncTelemetry,
} from "@/src/server/execution/cooperative-async.service";
import { getAutoRoundJobById } from "@/src/server/repositories/auto-round.repository";

export type CooperativeSelectionInput = {
  jobId: string;
  runId: string;
  roundNo: number;
  totalRounds: number;
  attempt: number;
  maxAttempts: number;
  selectionStartedAt: number;
  selectionBudgetMs: number;
  excludedSymbols: string[];
  forcePaperProfile: boolean;
  maxDurationSec: number;
  scanLimit: number;
  scanCycles: number;
  includeLivePumpScan: boolean;
};

export type CooperativeSelectionResult = {
  selected: ScannerCandidate | null;
  source: "pump-cache" | "pump-live" | "scanner" | null;
  reason: string;
  aborted?: boolean;
  abortCode?: RoundSelectionAbortError["code"];
};

function buildRuntimeHooks(
  controller: RoundRuntimeController,
  excludedSymbols: Set<string>,
  selectionDeadlineMs: number,
  selectionBudgetMs: number,
  jobId: string,
  roundContext: { roundId: string; runId: string },
): FastEntryRuntimeHooks {
  const asyncTelemetry = createAsyncTelemetry();
  const abortSignal = getRoundCancellationSignal(jobId);
  return {
    ensureActive: async () => {
      await controller.ensureJobActive();
      await controller.heartbeat();
    },
    shouldAbort: () => {
      controller.checkBudget(true);
    },
    abortSignal,
    selectionBudgetMs,
    onHeartbeat: async () => {
      await controller.heartbeat();
    },
    onProgress: async () => {
      controller.noteProgress(controller.getSnapshot().message);
    },
    asyncTelemetry,
    selectionDeadlineMs,
    forceFreshScanner: true,
    roundId: roundContext.roundId,
    runId: roundContext.runId,
    onPumpScan: async (scope, candidateCount, remaining) => {
      await controller.transition("PUMP_SCAN", `Pump taramasi (${scope}) aday=${candidateCount}, kalan=${remaining}`, {
        currentPipeline: scope === "cache" ? "pump-cache" : "pump-live",
        candidatesRemaining: remaining,
        pumpTotal: candidateCount,
        pumpProcessed: Math.max(0, candidateCount - remaining),
        currentScannerPhase: scope,
      });
    },
    onPumpConfirmation: async (symbol, index, total) => {
      await controller.transition("PUMP_CONFIRMATION", `${symbol} pump teyidi (${index}/${total})`, {
        currentCandidate: symbol,
        currentSymbol: symbol,
        currentPipeline: "pump-confirmation",
        candidatesRemaining: Math.max(0, total - index),
        pumpTotal: total,
        pumpProcessed: index,
        candidatesProcessed: index,
      });
    },
    onAiAnalysis: async (symbol, phase, decision) => {
      if (phase === "started") {
        await controller.transition("AI_ANALYSIS", `${symbol} AI analizi basladi`, {
          currentCandidate: symbol,
          currentSymbol: symbol,
          currentAiPhase: "consensus",
          currentPipeline: "pump-confirmation",
        });
        return;
      }
      await controller.heartbeat(`${symbol} AI sonuc: ${decision ?? "UNKNOWN"}`);
    },
    onCandidateRejected: async (symbol, reason) => {
      excludedSymbols.add(symbol);
      traceCandidateReject({
        symbol,
        stage: "candidate",
        reasonCode: "CANDIDATE_REJECTED",
        reasonDetail: reason,
      });
      await controller.noteCandidateRejected(symbol, reason);
    },
    onFullScan: async (cycle, maxCycles) => {
      await controller.transition("FULL_SCAN", `Tam tarayici (${cycle}/${maxCycles})`, {
        currentPipeline: "scanner-full",
        currentScannerPhase: `cycle-${cycle}`,
      });
    },
    onScannerCheckpoint: async (info) => {
      const phase = info.phase;
      controller.noteProgress(`Scanner ${phase} ${info.processed}/${info.total}`, {
        aiProcessed: phase === "ai" || phase === "consensus" ? info.processed : controller.getSnapshot().aiProcessed,
        aiTotal: info.total,
        candidatesProcessed: info.processed,
        candidatesRemaining: Math.max(0, info.total - info.processed),
        currentCandidate: info.symbol,
        currentSymbol: info.symbol,
      });
      const step =
        phase === "ai" || phase === "consensus"
          ? ("AI_ANALYSIS" as const)
          : phase === "discovery"
            ? ("SCANNING" as const)
            : phase === "ranking"
              ? ("SCANNING" as const)
              : ("SCANNING" as const);
      const patch =
        phase === "ai" || phase === "consensus"
          ? {
              currentPipeline: "scanner-full",
              currentScannerPhase: phase,
              currentCandidate: info.symbol,
              currentSymbol: info.symbol,
              candidatesProcessed: info.processed,
              candidatesRemaining: Math.max(0, info.total - info.processed),
              scannerTotal: info.total,
              aiProcessed: info.processed,
              aiTotal: info.total,
            }
          : {
              currentPipeline: phase === "discovery" ? "discovery-batch" : "scanner-full",
              currentScannerPhase: phase,
              currentCandidate: info.symbol,
              currentSymbol: info.symbol,
              candidatesProcessed: info.processed,
              candidatesRemaining: Math.max(0, info.total - info.processed),
              scannerTotal: info.total,
            };
      await controller.transition(step, `Scanner ${phase} ${info.processed}/${info.total}`, patch);
    },
  };
}

export async function runCooperativeRoundSelection(input: CooperativeSelectionInput): Promise<CooperativeSelectionResult> {
  registerRoundCancellation(input.jobId);
  const excludedSymbols = new Set(input.excludedSymbols.map((x) => x.toUpperCase()));
  const controller = new RoundRuntimeController(
    {
      jobId: input.jobId,
      runId: input.runId,
      roundNo: input.roundNo,
      totalRounds: input.totalRounds,
      selectionStartedAt: input.selectionStartedAt,
      selectionBudgetMs: input.selectionBudgetMs,
      selectionAttempt: input.attempt + 1,
      shouldStopJob: async () => {
        const job = await getAutoRoundJobById(input.jobId);
        return Boolean(job?.stopRequested);
      },
    },
    input.maxAttempts,
  );

  await controller.transition("SCANNER_STARTING", `Tur ${input.roundNo} secim dongusu basladi`, {
    selectionAttempt: input.attempt + 1,
    currentPipeline: "round-selection",
  });

  const runtime = buildRuntimeHooks(
    controller,
    excludedSymbols,
    input.selectionStartedAt + input.selectionBudgetMs,
    input.selectionBudgetMs,
    input.jobId,
    { roundId: String(input.roundNo), runId: input.runId },
  );
  const stopBudgetEnforcer = startSelectionBudgetEnforcer(
    input.jobId,
    input.selectionStartedAt,
    input.selectionBudgetMs,
  );
  const watchdog = startRoundSelectionWatchdog({
    jobId: input.jobId,
    getLastHeartbeatAt: () => controller.getSnapshot().heartbeatAt,
    getLastProgressAt: () => controller.getLastProgressAt(),
    getRuntimeSnapshot: () => controller.getSnapshot(),
    selectionBudgetMs: input.selectionBudgetMs,
    selectionStartedAt: input.selectionStartedAt,
    onStale: (reason) => {
      cancelRoundSelection(input.jobId, reason);
      terminalizeOpenAiCandidates({
        roundId: String(input.roundNo),
        runId: input.runId,
        reasonCode: reason.includes("budget") ? "SELECTION_BUDGET_EXCEEDED" : "ROUND_STALLED",
        cancelReason: reason,
        signalPropagated: true,
      });
    },
  });

  try {
    await controller.transition("PUMP_SCAN", "Pump oncelikli aday taramasi", {
      currentPipeline: "pump-cache",
    });
    let pumpBest: Awaited<ReturnType<typeof getPumpFastEntry>>;
    try {
      pumpBest = await getPumpFastEntry({
        excludeSymbols: Array.from(excludedSymbols),
        maxDurationSec: input.maxDurationSec,
        minConfidence: 45,
        includeLiveScan: input.includeLivePumpScan,
        runtime,
      });
    } catch (error) {
      if (error instanceof PumpScanFailedError) {
        await controller.transition("TIMEOUT", error.message, {
          currentPipeline: "pump-cache",
        });
        recordPumpScanEvent({
          kind: "failed",
          scope: "live",
          blockKind: error.blockKind,
          message: error.message,
        });
        traceCandidateFailed({
          symbol: "PUMP_SCAN",
          stage: "scanner",
          reasonCode: "PUMP_SCAN_FAILED",
          reasonDetail: error.message,
        });
        return {
          selected: null,
          source: null,
          reason: error.message,
          aborted: false,
        };
      }
      throw error;
    }

    if (pumpBest.selected) {
      await controller.transition("SYMBOL_SELECTED", `${pumpBest.selected.context.symbol} pump lane secildi`, {
        currentSymbol: pumpBest.selected.context.symbol.toUpperCase(),
        currentPipeline: "pump-cache",
      });
      return {
        selected: pumpBest.selected,
        source: pumpBest.reason?.includes("(live)") ? "pump-live" : "pump-cache",
        reason: pumpBest.reason ?? "Pump lane selected",
      };
    }

    await controller.transition("FULL_SCAN", "Pump adaylari tukendi, tam scanner devreye aliniyor", {
      currentPipeline: "scanner-full",
    });
    const best = await getBestFastEntry({
      excludeSymbols: Array.from(excludedSymbols),
      forcePaperProfile: input.forcePaperProfile,
      scanLimit: input.scanLimit,
      scanCycles: input.scanCycles,
      maxDurationSec: input.maxDurationSec,
      skipInitialPumpPass: true,
      runtime,
    });

    if (best.selected) {
      await controller.transition("SYMBOL_SELECTED", `${best.selected.context.symbol} scanner secimi`, {
        currentSymbol: best.selected.context.symbol.toUpperCase(),
        currentPipeline: "scanner-full",
      });
      return {
        selected: best.selected,
        source: "scanner",
        reason: best.reason ?? "Scanner selected candidate",
      };
    }

    traceCandidateWait({
      symbol: "NO_CANDIDATE",
      stage: "decision",
      reasonCode: "NO_CANDIDATE",
      reasonDetail: best.reason ?? pumpBest.reason ?? "Uygun coin secilemedi",
    });
    return {
      selected: null,
      source: null,
      reason: best.reason ?? pumpBest.reason ?? "Uygun coin secilemedi",
    };
  } catch (error) {
    if (error instanceof RoundSelectionAbortError) {
      await controller.failTimeout(error.message);
      return {
        selected: null,
        source: null,
        reason: error.message,
        aborted: true,
        abortCode: error.code,
      };
    }
    throw error;
  } finally {
    watchdog.stop();
    stopBudgetEnforcer();
    const telemetrySummary = summarizeAsyncTelemetry(runtime.asyncTelemetry ?? createAsyncTelemetry());
    await controller.heartbeat(`Selection async telemetry: ${JSON.stringify(telemetrySummary)}`).catch(() => null);
  }
}

export function resolveCooperativeScanLimit() {
  return Math.max(30, Math.min(env.SCANNER_CYCLE_SYMBOL_LIMIT, env.EXECUTION_MANUAL_SCAN_SYMBOL_LIMIT, 80));
}
