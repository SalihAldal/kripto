import { env } from "@/lib/config";
import { type FastEntryRuntimeHooks } from "@/src/server/scanner";
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
import { traceCandidateReject, traceCandidateWait } from "@/src/server/forensics/candidate-lifecycle.service";
import {
  createAsyncTelemetry,
  startRoundSelectionWatchdog,
  summarizeAsyncTelemetry,
} from "@/src/server/execution/cooperative-async.service";
import { getAutoRoundJobById } from "@/src/server/repositories/auto-round.repository";
import { ensureRoundHangSnapshotForAbnormalTerminal } from "@/src/server/forensics/round-progress-watchdog.service";
import { getLegacyScannerTelemetry } from "@/src/server/scanner/legacy-scanner-telemetry.service";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { getCanonicalInstanceOwnership } from "@/src/server/candidate/instance-ownership.service";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { observeCanonicalShadowTick } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { persistShadowOutcomes } from "@/src/server/shadow-outcome/persist";

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
  source: "pump-cache" | "pump-live" | "scanner" | "opportunity" | null;
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
        pumpSymbolsProcessed: Math.max(0, candidateCount - remaining),
        lastScannerProgressAt: new Date().toISOString(),
        lastPumpProgressAt: new Date().toISOString(),
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
        pumpSymbolsProcessed: index,
        lastScannerProgressAt: new Date().toISOString(),
        lastPumpProgressAt: new Date().toISOString(),
        candidatesProcessed: index,
      });
    },
    onAiAnalysis: async (symbol, phase, decision) => {
      if (phase === "started") {
        const snapshot = controller.getSnapshot();
        await controller.transition("AI_ANALYSIS", `${symbol} AI analizi basladi`, {
          currentCandidate: symbol,
          currentSymbol: symbol,
          currentAiPhase: "consensus",
          currentPipeline: "pump-confirmation",
          lastAIProgressAt: new Date().toISOString(),
          aiStarted: Number(snapshot.aiStarted ?? 0) + 1,
        });
        return;
      }
      await controller.heartbeat(`${symbol} AI sonuc: ${decision ?? "UNKNOWN"}`);
      controller.noteProgress(undefined, { lastAIProgressAt: new Date().toISOString() });
    },
    onCandidateRejected: async (symbol, reason) => {
      excludedSymbols.add(symbol);
      const snapshot = controller.getSnapshot();
      traceCandidateReject({
        symbol,
        stage: "candidate",
        reasonCode: "CANDIDATE_REJECTED",
        reasonDetail: reason,
      });
      if (reason.includes("AI") || reason.includes("consensus")) {
        controller.noteProgress(undefined, {
          aiFailed: Number(snapshot.aiFailed ?? 0) + 1,
        });
      }
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
        scannerSymbolsProcessed: info.processed,
        lastScannerProgressAt: new Date().toISOString(),
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
              lastAIProgressAt: new Date().toISOString(),
            }
          : {
              currentPipeline: phase === "discovery" ? "discovery-batch" : "scanner-full",
              currentScannerPhase: phase,
              currentCandidate: info.symbol,
              currentSymbol: info.symbol,
              candidatesProcessed: info.processed,
              candidatesRemaining: Math.max(0, info.total - info.processed),
              scannerTotal: info.total,
              lastScannerProgressAt: new Date().toISOString(),
            };
      await controller.transition(step, `Scanner ${phase} ${info.processed}/${info.total}`, patch);
    },
    onRuntimeProgress: async (patch) => {
      controller.noteActivity(undefined, patch);
    },
    onMarketDataEvent: async (event) => {
      controller.noteActivity(
        `Market data ${event.dataStatus} ${event.reasonCode} retry=${event.retryCount}`,
        {
          lastMarketDataProgressAt: event.endedAt,
        },
      );
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    currentScannerPhase: JSON.stringify(getCanonicalInstanceOwnership()),
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
  let terminalized = false;
  const terminalizeRound = async (reason: string, reasonCode: "SELECTION_BUDGET_EXCEEDED" | "ROUND_STALLED") => {
    if (terminalized) return;
    terminalized = true;
    const runtimeSnapshot = controller.getSnapshot();
    ensureRoundHangSnapshotForAbnormalTerminal({
      sessionId: input.jobId,
      roundId: String(input.roundNo),
      runId: input.runId,
      jobId: input.jobId,
      nowIso: new Date().toISOString(),
      startedAt: new Date(input.selectionStartedAt).toISOString(),
      endedAt: new Date().toISOString(),
      terminalReason: reason,
      terminalReasonCode: reasonCode,
      currentStage: String(runtimeSnapshot.step ?? "TIMEOUT"),
      currentCandidate: runtimeSnapshot.currentCandidate,
      runtime: runtimeSnapshot as unknown as Record<string, unknown>,
      activeRetries: Number(runtimeSnapshot.retryCount ?? 0),
      activeAI: Number(runtimeSnapshot.aiProcessed ?? 0),
      activeScannerWork: Number(runtimeSnapshot.scannerSymbolsProcessed ?? 0),
      activePumpWork: Number(runtimeSnapshot.pumpProcessed ?? 0),
      activeDBWork: Number(runtimeSnapshot.dbTransientFailures ?? 0),
    });
    cancelRoundSelection(input.jobId, reason);
    terminalizeOpenAiCandidates({
      roundId: String(input.roundNo),
      runId: input.runId,
      reasonCode,
      cancelReason: reason,
      signalPropagated: true,
    });
    await controller.failTimeout(reason).catch(() => null);
  };
  const watchdog = startRoundSelectionWatchdog({
    jobId: input.jobId,
    roundId: String(input.roundNo),
    getLastHeartbeatAt: () => controller.getSnapshot().heartbeatAt,
    getLastProgressAt: () => controller.getLastProgressAt(),
    getRuntimeSnapshot: () => controller.getSnapshot(),
    selectionBudgetMs: input.selectionBudgetMs,
    selectionStartedAt: input.selectionStartedAt,
    onStale: (reason) => {
      void terminalizeRound(
        reason,
        reason.includes("budget") ? "SELECTION_BUDGET_EXCEEDED" : "ROUND_STALLED",
      );
    },
  });

  try {
    const legacyBefore = getLegacyScannerTelemetry({ runId: input.runId, roundId: String(input.roundNo) });
    await controller.transition("FULL_SCAN", "Canonical candidate store observation basladi", {
      currentPipeline: "opportunity-engine",
    });
    const observationMs = Math.min(
      input.selectionBudgetMs,
      Math.max(90_000, Math.min(96_000, Number(env.AUTO_ROUND_LOOP_INTERVAL_MS ?? 95_000))),
    );
    const observationDeadline = Date.now() + observationMs;
    while (Date.now() < observationDeadline) {
      await runtime.ensureActive?.();
      await runtime.onHeartbeat?.();
      const daemon = getMarketDataDaemon();
      const snapshots = daemon.getMarketSnapshot();
      const opportunity = getOpportunityEngine().scan();
      const micro = getMicrostructureEngine().evaluate(opportunity.ranked);
      observeCanonicalShadowTick({
        opportunity: opportunity.ranked,
        micro: micro.ranked,
        snapshots,
      });
      void persistShadowOutcomes();
      const store = getCanonicalCandidateStore();
      const ready = store
        .getExecutionReadyCandidates()
        .filter((row) => !excludedSymbols.has(row.symbol.toUpperCase()))
        .sort((a, b) => Number(b.finalScore ?? b.microScore ?? 0) - Number(a.finalScore ?? a.microScore ?? 0));
      const selectedRecord = ready[0];
      const legacyAfter = getLegacyScannerTelemetry({ runId: input.runId, roundId: String(input.roundNo) });
      if (legacyAfter.runScopedInvocation > legacyBefore.runScopedInvocation) {
        return {
          selected: null,
          source: null,
          reason: "LEGACY_SCANNER_INVOKED_IN_CANONICAL_SELECTION",
          aborted: true,
          abortCode: "CANCELLED",
        };
      }
      if (legacyAfter.runScopedPersistence > legacyBefore.runScopedPersistence) {
        return {
          selected: null,
          source: null,
          reason: "LEGACY_SCANNER_PERSISTED_IN_CANONICAL_SELECTION",
          aborted: true,
          abortCode: "CANCELLED",
        };
      }
      if (selectedRecord) {
        const scannerCandidates = getMicrostructureEngine().toScannerCandidates();
        let selected = scannerCandidates.find(
          (row) => String(row.context.metadata.opportunityCandidateId ?? "") === selectedRecord.candidateId,
        );
        if (!selected) {
          // Candidate store can be ahead of scanner candidate projection; recover by symbol
          // so EXECUTION_READY records do not silently disappear from downstream pipeline.
          selected = scannerCandidates
            .filter((row) => row.context.symbol.toUpperCase() === selectedRecord.symbol.toUpperCase())
            .sort((a, b) => Number(b.score.score ?? 0) - Number(a.score.score ?? 0))[0];
        }
        if (selected) {
          await controller.transition("SYMBOL_SELECTED", `${selected.context.symbol} canonical opportunity secimi`, {
            currentSymbol: selected.context.symbol.toUpperCase(),
            currentPipeline: "opportunity-engine",
          });
          return {
            selected,
            source: "opportunity",
            reason: `CANDIDATE_STORE_EXECUTION_READY:${selectedRecord.candidateId}`,
          };
        }
      }
      const telemetry = store.getTelemetry();
      controller.noteProgress("Candidate store observation tick", {
        currentPipeline: "opportunity-engine",
        currentScannerPhase: "canonical-observe-loop",
        candidatesProcessed: Number(telemetry.byState.MICRO_ANALYZED ?? 0),
        candidatesRemaining: Number(telemetry.byState.MICRO_CONFIRMED ?? 0),
        scannerSymbolsProcessed: Number(opportunity.evaluated ?? 0),
        lastScannerProgressAt: new Date().toISOString(),
      });
      await controller.heartbeat(
        `Observe candidate store: discovered=${telemetry.byState.DISCOVERED ?? 0} hot=${telemetry.byState.HOT ?? 0} microConfirmed=${telemetry.byState.MICRO_CONFIRMED ?? 0} ready=${telemetry.executionReady}`,
      );
      await sleep(1_000);
    }
    const telemetry = getCanonicalCandidateStore().getTelemetry();
    const reason = `VALID_NO_CANDIDATE observedMs=${observationMs} discovered=${telemetry.byState.DISCOVERED ?? 0} hot=${telemetry.byState.HOT ?? 0} microConfirmed=${telemetry.byState.MICRO_CONFIRMED ?? 0} ready=${telemetry.executionReady}`;
    traceCandidateWait({
      symbol: "NO_CANDIDATE",
      stage: "decision",
      reasonCode: "NO_CANDIDATE",
      reasonDetail: reason,
    });
    return { selected: null, source: null, reason };
  } catch (error) {
    if (error instanceof RoundSelectionAbortError) {
      if (error.code !== "PERSIST_TIMEOUT") {
        await terminalizeRound(
          error.message,
          error.code === "BUDGET_EXPIRED" ? "SELECTION_BUDGET_EXCEEDED" : "ROUND_STALLED",
        );
      }
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
    const cancellationSignal = getRoundCancellationSignal(input.jobId);
    terminalizeOpenAiCandidates({
      roundId: String(input.roundNo),
      runId: input.runId,
      reasonCode: cancellationSignal?.aborted ? "ROUND_SELECTION_CANCELLED" : "ROUND_SELECTION_FINALIZED",
      cancelReason: cancellationSignal?.aborted
        ? String(cancellationSignal.reason ?? "Round selection cancelled")
        : "Round selection finalized",
      signalPropagated: Boolean(cancellationSignal?.aborted),
    });
    watchdog.stop();
    stopBudgetEnforcer();
    const telemetrySummary = summarizeAsyncTelemetry(runtime.asyncTelemetry ?? createAsyncTelemetry());
    await controller.heartbeat(`Selection async telemetry: ${JSON.stringify(telemetrySummary)}`).catch(() => null);
  }
}

export function resolveCooperativeScanLimit() {
  return Math.max(30, Math.min(env.SCANNER_CYCLE_SYMBOL_LIMIT, env.EXECUTION_MANUAL_SCAN_SYMBOL_LIMIT, 80));
}
