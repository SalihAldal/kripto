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
import {
  getCanonicalCandidateStore,
  subscribeCanonicalCandidateTransitions,
  type CanonicalCandidateRecord,
} from "@/src/server/candidate/candidate-store.service";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import { getCanonicalInstanceOwnership } from "@/src/server/candidate/instance-ownership.service";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import {
  attachCanonicalHandoff,
  buildCanonicalHandoffMetadata,
  validateCanonicalHandoffRecord,
} from "@/src/server/execution/canonical-handoff.service";
import { recordRoundPipelineTelemetry } from "@/src/server/execution/round-pipeline-telemetry.service";
import { observeCanonicalShadowTick } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { persistShadowOutcomes } from "@/src/server/shadow-outcome/persist";
import { setLegacyScannerCounters } from "@/src/server/execution/authority-counters.service";

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

function resolveEventDrivenConfig(input: { selectionBudgetMs: number; maxDurationSec: number }) {
  const envMap = env as unknown as Record<string, number | string | undefined>;
  const minimumEvidenceWindow = Number(envMap.AUTO_ROUND_SELECTION_MIN_EVIDENCE_WINDOW_MS ?? 400);
  const fallbackPollInterval = Number(envMap.AUTO_ROUND_SELECTION_FALLBACK_POLL_INTERVAL_MS ?? 750);
  const candidateEventDebounce = Number(envMap.AUTO_ROUND_SELECTION_EVENT_DEBOUNCE_MS ?? 120);
  const configuredDeadline = Number(envMap.AUTO_ROUND_SELECTION_DEADLINE_MS ?? input.maxDurationSec * 1000);
  return {
    minimumEvidenceWindowMs: Math.max(100, Math.min(5_000, minimumEvidenceWindow)),
    fallbackPollIntervalMs: Math.max(200, Math.min(5_000, fallbackPollInterval)),
    candidateEventDebounceMs: Math.max(0, Math.min(1_500, candidateEventDebounce)),
    selectionDeadlineMs: Math.max(5_000, Math.min(input.selectionBudgetMs, configuredDeadline)),
  };
}

function selectExecutionReadyRecord(store: ReturnType<typeof getCanonicalCandidateStore>, excluded: Set<string>) {
  const staleCutoff = Date.now() - 60_000;
  return store
    .getExecutionReadyCandidates()
    .filter((row) => !excluded.has(row.symbol.toUpperCase()))
    .filter((row) => row.lastUpdatedAt >= staleCutoff)
    .sort((a, b) => Number(b.finalScore ?? b.microScore ?? 0) - Number(a.finalScore ?? a.microScore ?? 0))[0] as
    | CanonicalCandidateRecord
    | undefined;
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
    const eventConfig = resolveEventDrivenConfig({
      selectionBudgetMs: input.selectionBudgetMs,
      maxDurationSec: input.maxDurationSec,
    });
    const observationMs = eventConfig.selectionDeadlineMs;
    const observationDeadline = Date.now() + observationMs;
    const store = getCanonicalCandidateStore();
    const tryResolveSelection = async () => {
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
      const telemetry = store.getTelemetry();
      controller.noteProgress("Candidate store observation tick", {
        currentPipeline: "opportunity-engine",
        currentScannerPhase: "canonical-event-driven",
        candidatesProcessed: Number(telemetry.byState.MICRO_ANALYZED ?? 0),
        candidatesRemaining: Number(telemetry.byState.MICRO_CONFIRMED ?? 0),
        scannerSymbolsProcessed: Number(opportunity.evaluated ?? 0),
        lastScannerProgressAt: new Date().toISOString(),
      });
      await controller.heartbeat(
        `Observe candidate store: discovered=${telemetry.byState.DISCOVERED ?? 0} hot=${telemetry.byState.HOT ?? 0} microConfirmed=${telemetry.byState.MICRO_CONFIRMED ?? 0} ready=${telemetry.executionReady}`,
      );
      const selectedRecord = selectExecutionReadyRecord(store, excludedSymbols);
      if (!selectedRecord) return null;
      const scannerCandidates = getMicrostructureEngine().toScannerCandidates();
      const selected = scannerCandidates.find(
        (row) => String(row.context.metadata.opportunityCandidateId ?? "") === selectedRecord.candidateId,
      );
      if (!selected) {
        return {
          error: `HANDOFF_CANDIDATE_NOT_FOUND:${selectedRecord.candidateId}`,
        };
      }
      return { selectedRecord, selected };
    };

    const legacyGuard = () => {
      const legacyAfter = getLegacyScannerTelemetry({ runId: input.runId, roundId: String(input.roundNo) });
      setLegacyScannerCounters({
        invocation: legacyAfter.runScopedInvocation,
        persist: legacyAfter.runScopedPersistence,
      });
      if (legacyAfter.runScopedInvocation > legacyBefore.runScopedInvocation) {
        return "LEGACY_SCANNER_INVOKED_IN_CANONICAL_SELECTION";
      }
      if (legacyAfter.runScopedPersistence > legacyBefore.runScopedPersistence) {
        return "LEGACY_SCANNER_PERSISTED_IN_CANONICAL_SELECTION";
      }
      return null;
    };

    let pendingResolve: ReturnType<typeof setTimeout> | null = null;
    let pendingResolveAt = 0;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let unsub: (() => void) | null = null;
    let settled = false;
    let inFlight = false;
    let pendingRecheck = false;
    const minimumCheckAt = Date.now() + eventConfig.minimumEvidenceWindowMs;
    const selectionResult = await new Promise<
      | { kind: "selected"; selectedRecord: CanonicalCandidateRecord; selected: ScannerCandidate }
      | { kind: "aborted"; reason: string }
      | { kind: "timeout" }
    >((resolve) => {
      const finish = (
        result:
          | { kind: "selected"; selectedRecord: CanonicalCandidateRecord; selected: ScannerCandidate }
          | { kind: "aborted"; reason: string }
          | { kind: "timeout" },
      ) => {
        if (settled) return;
        settled = true;
        if (pendingResolve) clearTimeout(pendingResolve);
        if (fallbackTimer) clearInterval(fallbackTimer);
        if (unsub) unsub();
        resolve(result);
      };
      const scheduleCheck = (delayMs: number) => {
        if (settled) return;
        if (pendingResolve && pendingResolveAt <= Date.now() + delayMs) {
          return;
        }
        if (pendingResolve) clearTimeout(pendingResolve);
        pendingResolveAt = Date.now() + Math.max(0, delayMs);
        pendingResolve = setTimeout(() => {
          pendingResolve = null;
          pendingResolveAt = 0;
          void check();
        }, Math.max(0, delayMs));
      };
      const check = async () => {
        if (settled) return;
        if (Date.now() < minimumCheckAt) return;
        if (inFlight) {
          pendingRecheck = true;
          return;
        }
        inFlight = true;
        const legacy = legacyGuard();
        if (legacy) {
          finish({ kind: "aborted", reason: legacy });
          inFlight = false;
          return;
        }
        if (Date.now() >= observationDeadline) {
          finish({ kind: "timeout" });
          inFlight = false;
          return;
        }
        await tryResolveSelection()
          .then((resolved) => {
            if (settled || !resolved) return;
            if ("error" in resolved) {
              finish({ kind: "aborted", reason: resolved.error ?? "HANDOFF_CANDIDATE_NOT_FOUND" });
              return;
            }
            finish({ kind: "selected", ...resolved });
          })
          .catch((error) => {
            if (settled) return;
            finish({
              kind: "aborted",
              reason: `SELECTION_EXCEPTION:${error instanceof Error ? error.message : String(error)}`,
            });
          })
          .finally(() => {
            inFlight = false;
            if (settled) return;
            if (pendingRecheck) {
              pendingRecheck = false;
              scheduleCheck(0);
            }
          });
      };
      unsub = subscribeCanonicalCandidateTransitions((event) => {
        if (settled) return;
        if (event.state !== "EXECUTION_READY" && event.state !== "FINAL_RANKED" && event.state !== "MICRO_CONFIRMED") {
          return;
        }
        if (excludedSymbols.has(event.symbol.toUpperCase())) return;
        const elapsedSinceTransition = Date.now() - event.at;
        const remainingDebounce = Math.max(
          eventConfig.minimumEvidenceWindowMs - elapsedSinceTransition,
          eventConfig.candidateEventDebounceMs,
        );
        // Keep the original evidence deadline: unrelated ticks must not postpone selection indefinitely.
        scheduleCheck(Math.max(0, remainingDebounce));
      });
      fallbackTimer = setInterval(() => {
        void check();
      }, eventConfig.fallbackPollIntervalMs);
      void check();
    });

    if (selectionResult.kind === "aborted") {
      return {
        selected: null,
        source: null,
        reason: selectionResult.reason,
        aborted: true,
        abortCode: "CANCELLED",
      };
    }
    if (selectionResult.kind === "selected") {
      const handoffMeta = buildCanonicalHandoffMetadata({
        candidateId: selectionResult.selectedRecord.candidateId,
        symbol: selectionResult.selected.context.symbol,
        record: selectionResult.selectedRecord,
        aiAdvisory: selectionResult.selected.context.metadata.aiAdvisory as
          | import("@/src/server/microstructure/types").AiAdvisory
          | undefined,
      });
      const validation = validateCanonicalHandoffRecord(handoffMeta, selectionResult.selected.context.symbol);
      if (!validation.ok) {
        return {
          selected: null,
          source: null,
          reason: `${validation.reasonCode}:${validation.reasonDetail}`,
        };
      }
      // Select first. The orchestrator validates identity, prepares the execution
      // venue, then performs consensus once. No slow source-quote AI before handoff.
      const selected = attachCanonicalHandoff(selectionResult.selected, handoffMeta);
      await controller.transition("SYMBOL_SELECTED", `${selected.context.symbol} canonical opportunity secimi`, {
        currentSymbol: selected.context.symbol.toUpperCase(),
        currentPipeline: "opportunity-engine",
      });
      recordRoundPipelineTelemetry({
        jobId: input.jobId,
        runId: input.runId,
        roundNo: input.roundNo,
        stage: "handoff",
        payload: {
          candidateId: handoffMeta.candidateId,
          symbol: selected.context.symbol,
          aiSource: "deferred_to_execution",
          aiConsensusStatus: handoffMeta.aiConsensusStatus,
          storeTelemetry: getCanonicalCandidateStore().getTelemetry(),
        },
      });
      return {
        selected,
        source: "opportunity",
        reason: `CANDIDATE_STORE_EXECUTION_READY:${selectionResult.selectedRecord.candidateId}`,
      };
    }
    const telemetry = getCanonicalCandidateStore().getTelemetry();
    recordRoundPipelineTelemetry({
      jobId: input.jobId,
      runId: input.runId,
      roundNo: input.roundNo,
      stage: "selection",
      payload: {
        outcome: "NO_ELIGIBLE_CANDIDATE",
        observedMs: observationMs,
        storeByState: telemetry.byState,
        executionReady: telemetry.executionReady,
        handoffErrorCounts: telemetry.handoffErrorCounts,
      },
    });
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
