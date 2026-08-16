import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ForensicSessionContext } from "@/src/server/forensics/forensic-context";
import { getCandidateLifecycleLog } from "@/src/server/forensics/candidate-lifecycle.service";
import { buildPnlLedgerSummary } from "@/src/server/forensics/pnl-ledger.service";
import { resolveRuntimeConfigSnapshot } from "@/src/server/forensics/resolved-config.service";
import { getPumpScanLifecycleEvents } from "@/src/server/scanner/pump-scan-lifecycle.service";
import { writeAiProgressArtifact, getAiBatchProgress, getConsensusAudits } from "@/src/server/forensics/ai-runtime.service";
import { writeTransactionDurationArtifact } from "@/src/server/forensics/transaction-telemetry.service";
import { getRecoveryTelemetryLog } from "@/src/server/forensics/recovery-telemetry.service";
import {
  evaluateRoundProgressStall,
  recordRoundWatchdogDecision,
} from "@/src/server/forensics/round-progress-watchdog.service";
import { buildP1ForensicReports } from "@/src/server/forensics/p1-forensic-report.service";
import { buildP2ForensicReports } from "@/src/server/forensics/p2-forensic-report.service";
import { bridgePostEntryNotDiscovered } from "@/src/server/forensics/forensic-bridge.service";
import { normalizeTdiDecisionRecord } from "@/src/server/forensics/tdi-decision-forensics.service";
import { TDI_DECISION_SCHEMA_VERSION } from "@/src/server/forensics/forensic.types";

export type RoundForensicExportInput = {
  session: ForensicSessionContext;
  roundId: string;
  runId: string;
  jobId: string;
  roundNo: number;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  symbol?: string | null;
  netPnl?: number | null;
  feeTotal?: number | null;
  result?: string | null;
  failReason?: string | null;
  userId?: string;
  terminalState?: string | null;
  currentStage?: string | null;
  lastProgressAt?: string | null;
  heartbeatAt?: string | null;
  elapsedMs?: number | null;
  selectionBudgetMs?: number | null;
};

function safeWriteJson(
  filePath: string,
  payload: unknown,
  tracker: { written: string[]; failed: Array<{ file: string; reason: string }> },
) {
  try {
    writeJson(filePath, payload);
    tracker.written.push(path.basename(filePath));
  } catch (error) {
    tracker.failed.push({ file: path.basename(filePath), reason: (error as Error).message });
  }
}

function writeJson(filePath: string, payload: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function filterByRun<T extends { timestamp?: string }>(
  rows: T[],
  runId: string,
  sessionRunId?: string,
) {
  if (rows.length === 0) return rows;
  return rows;
}

export async function exportRoundForensicArtifacts(input: RoundForensicExportInput) {
  const { session, roundId, runId } = input;
  const rootDir = path.join(process.cwd(), "artifacts", "forensics", session.sessionId, "rounds", roundId);
  mkdirSync(rootDir, { recursive: true });
  const tracker = { written: [] as string[], failed: [] as Array<{ file: string; reason: string }> };

  const lifecycle = getCandidateLifecycleLog(runId);
  const roundCandidates = session.candidates.filter(
    (row) => row.candidateTimestamp >= (input.startedAt ? new Date(input.startedAt).toISOString() : session.startedAt),
  );
  const roundTerminals = session.terminals;
  const roundDecisions = session.decisions;
  const roundOrders = session.orders.filter((row) => row.roundId === roundId || row.sessionId === runId);
  const roundPnl = session.pnlEntries.filter((row) => row.roundId === roundId || row.sessionId === runId);
  const pnlSummary = buildPnlLedgerSummary(roundPnl);
  const wins = roundPnl.filter((row) => row.netPnL > 0).length;
  const losses = roundPnl.filter((row) => row.netPnL < 0).length;
  const startedMs = input.startedAt ? new Date(input.startedAt).getTime() : Date.now();
  const endedMs = input.endedAt ? new Date(input.endedAt).getTime() : Date.now();
  const recoveryRecords = getRecoveryTelemetryLog(50).filter(
    (row) => !input.runId || row.runId === input.runId || row.roundId === String(input.roundNo),
  );
  const aiProgress = getAiBatchProgress(roundId, runId) ?? {
    roundId,
    runId,
    processed: 0,
    total: 0,
    artifactStatus: "MISSING",
    reason: "No AI batch progress recorded for this run",
  };
  const exportKind = input.failReason ? "failed-round-partial" : "completed-round-full";

  const summary = {
    roundId,
    runId,
    jobId: input.jobId,
    roundNo: input.roundNo,
    symbol: input.symbol ?? null,
    startedAt: input.startedAt ? new Date(input.startedAt).toISOString() : null,
    endedAt: input.endedAt ? new Date(input.endedAt).toISOString() : null,
    durationMs: Math.max(0, endedMs - startedMs),
    candidateCount: roundCandidates.length,
    tradeCount: roundOrders.filter((row) => row.side === "BUY").length,
    fills: roundOrders.filter((row) => row.fillId).length,
    wins,
    losses,
    grossPnL: pnlSummary.grossPnL,
    fees: pnlSummary.totalFees,
    netPnl: input.netPnl ?? pnlSummary.netPnL,
    maxDrawdown: pnlSummary.maxDrawdown,
    exitReasons: roundPnl.reduce<Record<string, number>>((acc, row) => {
      const key = row.exitReason ?? "UNKNOWN";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    failureCount: roundTerminals.filter((row) => row.verdict === "FAILED" || row.verdict === "REJECTED").length,
    result: input.result ?? null,
    failReason: input.failReason ?? null,
    terminalState: input.terminalState ?? null,
    currentStage: input.currentStage ?? (input.failReason ? "FAILED" : "COMPLETED"),
    lastProgressAt: input.lastProgressAt ?? null,
    heartbeatAt: input.heartbeatAt ?? null,
    elapsedMs: input.elapsedMs ?? null,
    selectionBudgetMs: input.selectionBudgetMs ?? null,
    exportKind,
    exportStatus: "COMPLETED",
    funnelState: {
      rejectionCountsByStage: session.rejectionCountsByStage,
      rejectionCountsByReason: session.rejectionCountsByReason,
    },
  };

  safeWriteJson(path.join(rootDir, "round-summary.json"), summary, tracker);
  safeWriteJson(path.join(rootDir, "recovery-decisions.json"), { records: recoveryRecords }, tracker);
  safeWriteJson(path.join(rootDir, "recovery-telemetry.json"), { records: getRecoveryTelemetryLog(50) }, tracker);
  safeWriteJson(path.join(rootDir, "scanner-summary.json"), {
    cycles: session.scannerCycles,
    rejectionCounts: session.rejectionCountsByReason,
    artifactStatus: session.scannerCycles.length > 0 ? "PRESENT" : "MISSING",
    reason: session.scannerCycles.length > 0 ? undefined : "No scanner cycles recorded in forensic session",
  }, tracker);
  safeWriteJson(path.join(rootDir, "ai-progress.json"), aiProgress, tracker);

  const resolvedConfig = input.userId ? await resolveRuntimeConfigSnapshot(input.userId).catch(() => null) : null;

  const refs = {
    scanner: "scanner-summary.json",
    candidates: "candidate-trace.json",
    decisions: "decision-trace.json",
    consensus: "consensus-trace.json",
    ev: "ev-trace.json",
    ai: "ai-trace.json",
    risk: "risk-sizing-trace.json",
    execution: "execution-trace.json",
    pnl: "pnl-ledger.json",
    lifecycle: "candidate-lifecycle.json",
    pumpScan: "pump-scan-lifecycle.json",
    aiProgress: "ai-progress.json",
    roundWatchdog: "round-watchdog.json",
    transactionDuration: "transaction-duration.json",
    recovery: "recovery-telemetry.json",
    config: resolvedConfig ? "resolved-config.json" : null,
    meanReversion: "mean-reversion-audit.json",
    scannerQualification: "scanner-qualification.json",
    notDiscovered: "not-discovered-analysis.json",
    evCalibration: "ev-calibration.json",
    evComponentAttribution: "ev-component-attribution.json",
    entryTiming: "entry-timing.json",
    strategyPerformance: "strategy-performance.json",
    strategyRegimeMatrix: "strategy-regime-matrix.json",
    mrRegimeGatingExperiment: "mr-regime-gating-experiment.json",
    opportunityFunnel: "opportunity-funnel.json",
    lossPatterns: "loss-patterns.json",
    winningPatterns: "winning-patterns.json",
    feeAwareEdgeResearch: "fee-aware-edge-research.json",
    p1PromotionGate: "p1-promotion-gate.json",
    tdiDecisions: "tdi-decisions.json",
    slotOpportunity: "slot-opportunity-report.json",
    strategyComparison: "strategy-comparison-report.json",
    feePolicy: "fee-aware-entry-policy.json",
    volatilityBreakout: "volatility-breakout-validation.json",
    promotionGate: "promotion-gate.json",
    slotAllocationAnalysis: "slot-allocation-analysis.json",
    slotAllocationExperiment: "slot-allocation-experiment.json",
    tdiSensitivity: "tdi-sensitivity.json",
    feeAwareEntryExperiment: "fee-aware-entry-experiment.json",
    entryTimingExperiment: "entry-timing-experiment.json",
    aiStrategyInteraction: "ai-strategy-interaction.json",
    opportunityValue: "opportunity-value.json",
    profitabilityExperiments: "profitability-experiments.json",
    promotionDecisions: "promotion-decisions.json",
  };

  safeWriteJson(path.join(rootDir, "candidate-trace.json"), {
    candidates: roundCandidates,
    terminals: roundTerminals,
    lifecycle,
  }, tracker);
  safeWriteJson(path.join(rootDir, "strategy-trace.json"), {
    decisions: roundDecisions.filter((row) => row.stage === "strategy"),
  }, tracker);
  safeWriteJson(path.join(rootDir, "ev-trace.json"), { evAudits: session.evAudits }, tracker);
  safeWriteJson(path.join(rootDir, "ai-trace.json"), { aiCalls: session.aiCalls }, tracker);
  safeWriteJson(path.join(rootDir, "consensus-trace.json"), { consensus: session.consensus, audits: getConsensusAudits(100) }, tracker);
  safeWriteJson(path.join(rootDir, "decision-trace.json"), { decisions: roundDecisions }, tracker);
  safeWriteJson(path.join(rootDir, "risk-sizing-trace.json"), { riskSizing: session.riskSizing }, tracker);
  safeWriteJson(path.join(rootDir, "execution-trace.json"), { orders: roundOrders }, tracker);
  safeWriteJson(path.join(rootDir, "position-trace.json"), {
    orders: roundOrders.filter((row) => row.positionId),
  }, tracker);
  safeWriteJson(path.join(rootDir, "exit-trace.json"), {
    pnlEntries: roundPnl,
    exitReasons: roundPnl.map((row) => row.exitReason).filter(Boolean),
  }, tracker);
  safeWriteJson(path.join(rootDir, "pnl-ledger.json"), { entries: roundPnl, summary: pnlSummary }, tracker);
  safeWriteJson(path.join(rootDir, "missed-opportunities.json"), {
    records: roundTerminals.filter((row) => row.verdict !== "APPROVED"),
  }, tracker);
  safeWriteJson(path.join(rootDir, "candidate-lifecycle.json"), lifecycle, tracker);
  safeWriteJson(path.join(rootDir, "pump-scan-lifecycle.json"), getPumpScanLifecycleEvents(100), tracker);

  const watchdogRecord = evaluateRoundProgressStall({
    roundId,
    runId,
    jobId: input.jobId,
    lastProgressAt: input.lastProgressAt ?? (input.startedAt ? new Date(input.startedAt).toISOString() : undefined),
    lastHeartbeatAt: input.heartbeatAt ?? (input.endedAt ? new Date(input.endedAt).toISOString() : undefined),
    currentStage: input.currentStage ?? (input.failReason ? "FAILED" : "COMPLETED"),
    workerAlive: true,
  });
  recordRoundWatchdogDecision(watchdogRecord);
  safeWriteJson(path.join(rootDir, "round-watchdog.json"), watchdogRecord, tracker);
  try {
    writeTransactionDurationArtifact({ sessionId: session.sessionId, roundId });
    tracker.written.push("transaction-duration.json");
  } catch (error) {
    tracker.failed.push({ file: "transaction-duration.json", reason: (error as Error).message });
  }
  safeWriteJson(path.join(rootDir, "stage-timings.json"), {
    rejectionCountsByStage: session.rejectionCountsByStage,
    pumpScanEvents: getPumpScanLifecycleEvents(20),
  }, tracker);
  safeWriteJson(path.join(rootDir, "errors.json"), {
    failReason: input.failReason ?? null,
    failures: roundTerminals.filter((row) => row.verdict === "FAILED"),
  }, tracker);
  if (resolvedConfig) {
    safeWriteJson(path.join(rootDir, "resolved-config.json"), resolvedConfig, tracker);
  }

  const postEntrySymbols = (process.env.FORENSIC_POST_ENTRY_SYMBOLS ?? "")
    .split(",")
    .map((row) => row.trim().toUpperCase())
    .filter(Boolean);
  for (const symbol of postEntrySymbols) {
    try {
      bridgePostEntryNotDiscovered({
        symbol,
        watchlist: session.scannerUniverseSnapshot?.watchlist ?? [],
        cycleSymbols: session.scannerUniverseSnapshot?.cycleSymbols ?? [],
      });
    } catch {
      // optional bridge — must not block export
    }
  }

  try {
    const p1Reports = buildP1ForensicReports(session);
    safeWriteJson(path.join(rootDir, "mean-reversion-audit.json"), {
      entries: p1Reports.meanReversionEntries,
      analysis: p1Reports.meanReversionAnalysis,
    }, tracker);
    safeWriteJson(path.join(rootDir, "scanner-qualification.json"), {
      rejections: p1Reports.scannerQualificationRejections,
    }, tracker);
    safeWriteJson(path.join(rootDir, "not-discovered-analysis.json"), {
      records: p1Reports.notDiscoveredRecords,
    }, tracker);
    safeWriteJson(path.join(rootDir, "ev-calibration.json"), p1Reports.evCalibration, tracker);
    safeWriteJson(path.join(rootDir, "ev-component-attribution.json"), p1Reports.evComponentAttribution, tracker);
    safeWriteJson(path.join(rootDir, "entry-timing.json"), {
      records: p1Reports.entryTimingRecords,
    }, tracker);
    safeWriteJson(path.join(rootDir, "strategy-performance.json"), p1Reports.strategyPerformance, tracker);
    safeWriteJson(path.join(rootDir, "strategy-regime-matrix.json"), p1Reports.strategyRegimeMatrix, tracker);
    safeWriteJson(path.join(rootDir, "mr-regime-gating-experiment.json"), p1Reports.mrRegimeGatingExperiment, tracker);
    safeWriteJson(path.join(rootDir, "opportunity-funnel.json"), p1Reports.opportunityFunnel, tracker);
    safeWriteJson(path.join(rootDir, "loss-patterns.json"), p1Reports.lossPatterns, tracker);
    safeWriteJson(path.join(rootDir, "winning-patterns.json"), p1Reports.winningPatterns, tracker);
    safeWriteJson(path.join(rootDir, "fee-aware-edge-research.json"), p1Reports.feeAwareEdgeResearch, tracker);
    safeWriteJson(path.join(rootDir, "p1-promotion-gate.json"), p1Reports.promotionGate, tracker);

    const p2Reports = buildP2ForensicReports(session);
    safeWriteJson(
      path.join(rootDir, "tdi-decisions.json"),
      {
        schemaVersion: TDI_DECISION_SCHEMA_VERSION,
        records: p2Reports.tdiDecisions.map((row) => normalizeTdiDecisionRecord(row)),
      },
      tracker,
    );
    safeWriteJson(path.join(rootDir, "slot-opportunity-report.json"), p2Reports.slotOpportunity, tracker);
    safeWriteJson(path.join(rootDir, "strategy-comparison-report.json"), p2Reports.strategyComparison, tracker);
    safeWriteJson(path.join(rootDir, "fee-aware-entry-policy.json"), { evaluations: p2Reports.feePolicySamples }, tracker);
    safeWriteJson(path.join(rootDir, "volatility-breakout-validation.json"), p2Reports.volatilityBreakout, tracker);
    safeWriteJson(path.join(rootDir, "promotion-gate.json"), p2Reports.promotionGate, tracker);
    safeWriteJson(path.join(rootDir, "slot-allocation-analysis.json"), p2Reports.slotAllocationAnalysis, tracker);
    safeWriteJson(path.join(rootDir, "slot-allocation-experiment.json"), p2Reports.slotAllocationExperiment, tracker);
    safeWriteJson(path.join(rootDir, "tdi-sensitivity.json"), p2Reports.tdiSensitivity, tracker);
    safeWriteJson(path.join(rootDir, "fee-aware-entry-experiment.json"), p2Reports.feeAwareEntryExperiment, tracker);
    safeWriteJson(path.join(rootDir, "entry-timing-experiment.json"), p2Reports.entryTimingExperiment, tracker);
    safeWriteJson(path.join(rootDir, "ai-strategy-interaction.json"), p2Reports.aiStrategyInteraction, tracker);
    safeWriteJson(path.join(rootDir, "opportunity-value.json"), p2Reports.opportunityValue, tracker);
    safeWriteJson(path.join(rootDir, "profitability-experiments.json"), p2Reports.experimentRegistry, tracker);
    safeWriteJson(path.join(rootDir, "promotion-decisions.json"), { decisions: p2Reports.promotionDecisions }, tracker);
    safeWriteJson(path.join(rootDir, "strategy-regime-matrix-p2.json"), p2Reports.strategyRegimeMatrix, tracker);

    summary.funnelState = {
      ...summary.funnelState,
      tdiDecisions: p2Reports.tdiDecisions.length,
      scannerQualificationRejections: p1Reports.scannerQualificationRejections.length,
    };
    summary.artifactRefs = refs;
    safeWriteJson(path.join(rootDir, "round-summary.json"), summary, tracker);
  } catch (error) {
    tracker.failed.push({ file: "p1-p2-reports", reason: (error as Error).message });
    summary.artifactRefs = refs;
    summary.exportStatus = tracker.failed.length > 0 ? "PARTIAL" : "COMPLETED";
    safeWriteJson(path.join(rootDir, "round-summary.json"), summary, tracker);
  }

  const required = ["round-summary.json", "recovery-decisions.json", "recovery-telemetry.json"];
  const missingRequired = required.filter((name) => !tracker.written.includes(name));
  if (missingRequired.length > 0) {
    throw new Error(`Failed to write required forensic artifacts: ${missingRequired.join(", ")}`);
  }

  return {
    rootDir,
    summary: {
      ...summary,
      exportStatus: tracker.failed.length > 0 ? "PARTIAL" : "COMPLETED",
      writtenArtifacts: tracker.written,
      failedArtifacts: tracker.failed,
    },
  };
}
