import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ForensicSessionContext } from "@/src/server/forensics/forensic-context";
import { getCandidateLifecycleLog } from "@/src/server/forensics/candidate-lifecycle.service";
import { buildPnlLedgerSummary } from "@/src/server/forensics/pnl-ledger.service";
import { resolveRuntimeConfigSnapshot } from "@/src/server/forensics/resolved-config.service";
import { getPumpScanLifecycleEvents } from "@/src/server/scanner/pump-scan-lifecycle.service";
import { writeAiProgressArtifact, getAiBatchProgress, getConsensusAudits } from "@/src/server/forensics/ai-runtime.service";
import { getTransactionDurationLog, writeTransactionDurationArtifact } from "@/src/server/forensics/transaction-telemetry.service";
import { getRecoveryTelemetryLog } from "@/src/server/forensics/recovery-telemetry.service";
import {
  evaluateRoundProgressStall,
  recordRoundWatchdogDecision,
  writeRoundLivenessArtifact,
} from "@/src/server/forensics/round-progress-watchdog.service";
import { buildP1ForensicReports } from "@/src/server/forensics/p1-forensic-report.service";
import { buildP2ForensicReports } from "@/src/server/forensics/p2-forensic-report.service";
import {
  buildProfitabilityExperimentsCsv,
  buildStrategyRegimeMatrixCsv,
} from "@/src/server/forensics/forensic-csv-export.service";
import { bridgePostEntryNotDiscovered } from "@/src/server/forensics/forensic-bridge.service";
import { normalizeTdiDecisionRecord } from "@/src/server/forensics/tdi-decision-forensics.service";
import { buildTdiDataQualityArtifacts } from "@/src/server/forensics/tdi-data-quality.service";
import { TDI_DECISION_SCHEMA_VERSION } from "@/src/server/forensics/forensic.types";
import { getAutoRoundRunById } from "@/src/server/repositories/auto-round.repository";
import { readRuntimeFromMetadata } from "@/src/server/execution/round-runtime.service";

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

function safeWriteCsv(
  filePath: string,
  payload: string,
  tracker: { written: string[]; failed: Array<{ file: string; reason: string }> },
) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, payload, "utf8");
    tracker.written.push(path.basename(filePath));
  } catch (error) {
    tracker.failed.push({ file: path.basename(filePath), reason: (error as Error).message });
  }
}

function writeJson(filePath: string, payload: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toMs(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterByRun<T extends Record<string, unknown>>(input: {
  rows: T[];
  runId: string;
  roundId: string;
  roundNo: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
}) {
  if (input.rows.length === 0) return input.rows;
  return input.rows.filter((row) => {
    const runField = String(row.runId ?? row.sessionId ?? "");
    if (runField) return runField === input.runId;
    const roundField = String(row.roundId ?? "");
    if (roundField) return roundField === input.roundId || roundField === String(input.roundNo);
    const meta = (row.metadata as Record<string, unknown> | undefined) ?? {};
    const metaRunId = String(meta.runId ?? meta.sessionId ?? "");
    if (metaRunId) return metaRunId === input.runId;
    const metaRoundId = String(meta.roundId ?? "");
    if (metaRoundId) return metaRoundId === input.roundId || metaRoundId === String(input.roundNo);
    const ts =
      toMs(row.timestamp ?? row.candidateTimestamp ?? row.startedAt ?? row.endedAt) ??
      toMs(meta.timestamp ?? meta.candidateTimestamp ?? meta.startedAt ?? meta.endedAt);
    if (ts === null || input.startedAtMs === null) return false;
    if (input.endedAtMs === null) return ts >= input.startedAtMs;
    return ts >= input.startedAtMs && ts <= input.endedAtMs;
  });
}

type BudgetStage =
  | "scanner_startup"
  | "pump_discovery"
  | "priority_discovery"
  | "market_data_discovery"
  | "market_context"
  | "candidate_generation"
  | "strategy_intelligence"
  | "ev"
  | "oi"
  | "tdi"
  | "ai_queue_wait"
  | "ai_execution"
  | "ai_retries"
  | "ai_provider_latency"
  | "risk"
  | "sizing"
  | "execution_preparation"
  | "persistence"
  | "forensics";

const REQUIRED_BUDGET_STAGES: BudgetStage[] = [
  "scanner_startup",
  "pump_discovery",
  "priority_discovery",
  "market_data_discovery",
  "market_context",
  "candidate_generation",
  "strategy_intelligence",
  "ev",
  "oi",
  "tdi",
  "ai_queue_wait",
  "ai_execution",
  "ai_retries",
  "ai_provider_latency",
  "risk",
  "sizing",
  "execution_preparation",
  "persistence",
  "forensics",
];

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[idx] ?? 0;
}

function mapRuntimeStepToBudgetStage(step?: string): BudgetStage {
  switch (step) {
    case "SCANNER_STARTING":
      return "scanner_startup";
    case "PUMP_SCAN":
      return "pump_discovery";
    case "PUMP_CONFIRMATION":
      return "priority_discovery";
    case "SCANNING":
    case "FULL_SCAN":
      return "candidate_generation";
    case "AI_ANALYSIS":
      return "ai_execution";
    case "CANDIDATE_REJECTED":
    case "NEXT_CANDIDATE":
      return "strategy_intelligence";
    case "SYMBOL_SELECTED":
      return "execution_preparation";
    case "EXECUTING":
      return "risk";
    case "POSITION_OPEN":
    case "POSITION_MONITORING":
    case "POSITION_CLOSED":
      return "execution_preparation";
    case "ROUND_COMPLETED":
    case "ROUND_FAILED":
    case "TIMEOUT":
      return "forensics";
    default:
      return "candidate_generation";
  }
}

function buildSelectionTimeBudgetBreakdown(input: {
  selectionBudgetMs: number;
  durationMs: number;
  runtimeTimeline?: Array<{ at?: string; step?: string; kind?: string }>;
  txRecords: Array<{ operation?: string; durationMs?: number }>;
}) {
  const byStage = new Map<BudgetStage, number[]>();
  const push = (stage: BudgetStage, durationMs: number) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const arr = byStage.get(stage) ?? [];
    arr.push(durationMs);
    byStage.set(stage, arr);
  };

  const timeline = (input.runtimeTimeline ?? [])
    .filter((row) => row && typeof row.at === "string")
    .sort((a, b) => new Date(String(a.at)).getTime() - new Date(String(b.at)).getTime());
  for (let i = 0; i < timeline.length; i += 1) {
    const current = timeline[i];
    const next = timeline[i + 1];
    const currentMs = new Date(String(current.at)).getTime();
    const nextMs = next ? new Date(String(next.at)).getTime() : Number.NaN;
    const durationMs = Number.isFinite(nextMs)
      ? Math.max(0, nextMs - currentMs)
      : Math.max(0, input.durationMs - (currentMs - (timeline.length > 0 ? new Date(String(timeline[0].at)).getTime() : currentMs)));
    push(mapRuntimeStepToBudgetStage(current.step), durationMs);
  }

  for (const tx of input.txRecords) {
    const op = String(tx.operation ?? "");
    const durationMs = Number(tx.durationMs ?? 0);
    if (!op || !Number.isFinite(durationMs)) continue;
    if (op.includes("patchJobActiveRound") || op.includes("mergeRunMetadata")) {
      push("persistence", durationMs);
    }
    if (op.includes("forensic") || op.includes("export")) {
      push("forensics", durationMs);
    }
  }

  const rows = REQUIRED_BUDGET_STAGES.map((stage) => {
    const samples = byStage.get(stage) ?? [];
    const totalMs = samples.reduce((acc, x) => acc + x, 0);
    return {
      stage,
      count: samples.length,
      totalMs,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
      max: samples.length > 0 ? Math.max(...samples) : 0,
      shareOfSelectionBudget:
        input.selectionBudgetMs > 0 ? Number(((totalMs / input.selectionBudgetMs) * 100).toFixed(4)) : 0,
    };
  });

  const measuredTotalMs = rows.reduce((acc, row) => acc + row.totalMs, 0);
  const unattributedMs = Math.max(0, input.durationMs - measuredTotalMs);
  if (unattributedMs > 0) {
    const fallbackRow = rows.find((row) => row.stage === "forensics");
    if (fallbackRow) {
      fallbackRow.totalMs += unattributedMs;
      fallbackRow.shareOfSelectionBudget =
        input.selectionBudgetMs > 0 ? Number(((fallbackRow.totalMs / input.selectionBudgetMs) * 100).toFixed(4)) : 0;
    }
  }

  const ranked = [...rows].sort((a, b) => b.totalMs - a.totalMs);
  return {
    generatedAt: new Date().toISOString(),
    selectionBudgetMs: input.selectionBudgetMs,
    totalElapsedMs: input.durationMs,
    measuredTotalMs: rows.reduce((acc, row) => acc + row.totalMs, 0),
    PRIMARY_TIME_CONSUMER: ranked[0]?.stage ?? "unknown",
    TOP_5_TIME_CONSUMERS: ranked.slice(0, 5).map((row) => ({ stage: row.stage, totalMs: row.totalMs })),
    rows,
  };
}

export async function exportRoundForensicArtifacts(input: RoundForensicExportInput) {
  const { session, roundId, runId } = input;
  const rootDir = path.join(process.cwd(), "artifacts", "forensics", session.sessionId, "rounds", roundId);
  mkdirSync(rootDir, { recursive: true });
  const tracker = { written: [] as string[], failed: [] as Array<{ file: string; reason: string }> };

  const lifecycle = getCandidateLifecycleLog(runId);
  const startedAtMs = input.startedAt ? new Date(input.startedAt).getTime() : null;
  const endedAtMs = input.endedAt ? new Date(input.endedAt).getTime() : null;
  const scoped = <T extends Record<string, unknown>>(rows: T[]) =>
    filterByRun({
      rows,
      runId,
      roundId,
      roundNo: input.roundNo,
      startedAtMs: Number.isFinite(startedAtMs ?? Number.NaN) ? startedAtMs : null,
      endedAtMs: Number.isFinite(endedAtMs ?? Number.NaN) ? endedAtMs : null,
    });
  const roundCandidates = scoped(session.candidates as unknown as Record<string, unknown>[]) as typeof session.candidates;
  const roundTerminals = scoped(session.terminals as unknown as Record<string, unknown>[]) as typeof session.terminals;
  const roundDecisions = scoped(session.decisions as unknown as Record<string, unknown>[]) as typeof session.decisions;
  const roundAiCalls = scoped((session.aiCalls ?? []) as unknown as Record<string, unknown>[]) as typeof session.aiCalls;
  const roundConsensus = scoped(session.consensus as unknown as Record<string, unknown>[]) as typeof session.consensus;
  const roundEvAudits = scoped(session.evAudits as unknown as Record<string, unknown>[]) as typeof session.evAudits;
  const roundRiskSizing = scoped(session.riskSizing as unknown as Record<string, unknown>[]) as typeof session.riskSizing;
  const roundTdiDecisions = scoped((session.tdiDecisions ?? []) as unknown as Record<string, unknown>[]) as typeof session.tdiDecisions;
  const roundOrders = session.orders.filter((row) => row.roundId === roundId || row.sessionId === runId);
  const roundPnl = session.pnlEntries.filter((row) => row.roundId === roundId || row.sessionId === runId);
  const rejectionCountsByStage = roundTerminals.reduce<Record<string, number>>((acc, row) => {
    if (row.verdict === "REJECTED" || row.verdict === "FAILED" || row.verdict === "UNKNOWN") {
      acc[row.stage] = (acc[row.stage] ?? 0) + 1;
    }
    return acc;
  }, {});
  const rejectionCountsByReason = roundTerminals.reduce<Record<string, number>>((acc, row) => {
    if (row.verdict === "REJECTED" || row.verdict === "FAILED" || row.verdict === "UNKNOWN") {
      acc[row.reasonCode] = (acc[row.reasonCode] ?? 0) + 1;
    }
    return acc;
  }, {});
  const pnlSummary = buildPnlLedgerSummary(roundPnl);
  const wins = roundPnl.filter((row) => row.netPnL > 0).length;
  const losses = roundPnl.filter((row) => row.netPnL < 0).length;
  const startedMs = input.startedAt ? new Date(input.startedAt).getTime() : Date.now();
  const endedMs = input.endedAt ? new Date(input.endedAt).getTime() : Date.now();
  const durationMs = Math.max(0, endedMs - startedMs);
  let runRow: Awaited<ReturnType<typeof getAutoRoundRunById>> | null = null;
  try {
    runRow = await getAutoRoundRunById(runId);
  } catch (error) {
    tracker.failed.push({
      file: "runtime-read",
      reason: `AUTO_ROUND_RUN_READ_FAILED: ${(error as Error).message}`,
    });
  }
  const runtimeSnapshot = readRuntimeFromMetadata((runRow?.metadata as Record<string, unknown> | null) ?? null);
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
    durationMs,
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
      rejectionCountsByStage,
      rejectionCountsByReason,
    },
  };

  safeWriteJson(path.join(rootDir, "round-summary.json"), summary, tracker);
  safeWriteJson(path.join(rootDir, "recovery-decisions.json"), { records: recoveryRecords }, tracker);
  safeWriteJson(path.join(rootDir, "recovery-telemetry.json"), { records: recoveryRecords }, tracker);
  safeWriteJson(path.join(rootDir, "scanner-summary.json"), {
    cycles: session.scannerCycles,
    rejectionCounts: rejectionCountsByReason,
    coverage: session.scannerCoverageSnapshots ?? [],
    latestCoverage: (session.scannerCoverageSnapshots ?? []).at(-1) ?? null,
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
    roundLiveness: "round-liveness.json",
    selectionTimeBudgetBreakdown: "selectionTimeBudgetBreakdown.json",
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
    exitForensics: "exit-forensics.json",
    replayExitDiagnostics: "replay-exit-diagnostics.json",
    replayExitDiagnosticsCamel: "replayExitDiagnostics.json",
    grossPositiveNetNegative: "gross-positive-net-negative.json",
    feeByStrategy: "fee-by-strategy.json",
    feeByHoldTime: "fee-by-hold-time.json",
    exitFeeInteraction: "exit-fee-interaction.json",
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
    baselineMetrics: "baseline-metrics.json",
    outOfSampleEvaluation: "out-of-sample-evaluation.json",
    profitConcentration: "profit-concentration.json",
    candidateQualityFactors: "candidate-quality-factors.json",
    trendFollowingValidation: "trend-following-validation.json",
    singleChangeExperiments: "single-change-experiments.json",
    strategyRegimeMatrixCsv: "strategy-regime-matrix-p2.csv",
    profitabilityExperimentsCsv: "profitability-experiments.csv",
    tdiDataQuality: "tdi-data-quality.json",
    tdiInputContract: "tdi-input-contract.json",
    tdiMissingTelemetry: "tdi-missing-telemetry-report.json",
  };

  safeWriteJson(path.join(rootDir, "candidate-trace.json"), {
    candidates: roundCandidates,
    terminals: roundTerminals,
    lifecycle,
  }, tracker);
  safeWriteJson(path.join(rootDir, "strategy-trace.json"), {
    decisions: roundDecisions.filter((row) => row.stage === "strategy"),
  }, tracker);
  safeWriteJson(path.join(rootDir, "ev-trace.json"), { evAudits: roundEvAudits }, tracker);
  const aiCalls = roundAiCalls ?? [];
  const aiProviderCallCount = aiCalls.length;
  const aiRemoteProviderCallCount = aiCalls.filter((row) => row.remote === true || row.executionMode === "REMOTE").length;
  const aiDegradedProviderCallCount = aiCalls.filter((row) => row.degraded === true).length;
  const aiUniqueCandidates = new Set(aiCalls.map((row) => row.candidateId).filter(Boolean)).size;
  safeWriteJson(
    path.join(rootDir, "ai-trace.json"),
    {
      aiCalls,
      metricsV2: {
        aiProviderCallCount,
        aiRemoteProviderCallCount,
        aiDegradedProviderCallCount,
        aiUniqueCandidateCount: aiUniqueCandidates,
      },
    },
    tracker,
  );
  safeWriteJson(path.join(rootDir, "consensus-trace.json"), { consensus: roundConsensus, audits: getConsensusAudits(100) }, tracker);
  safeWriteJson(path.join(rootDir, "decision-trace.json"), { decisions: roundDecisions }, tracker);
  safeWriteJson(path.join(rootDir, "risk-sizing-trace.json"), { riskSizing: roundRiskSizing }, tracker);
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
  writeRoundLivenessArtifact({
    sessionId: session.sessionId,
    roundId,
    nowIso: new Date().toISOString(),
    currentStage: input.currentStage ?? runtimeSnapshot?.step,
    runtime: (runtimeSnapshot ?? {}) as unknown as Record<string, unknown>,
    watchdog: watchdogRecord as unknown as Record<string, unknown>,
  });
  tracker.written.push("round-liveness.json");
  try {
    writeTransactionDurationArtifact({
      sessionId: session.sessionId,
      roundId,
      jobId: input.jobId,
      runId: input.runId,
    });
    tracker.written.push("transaction-duration.json");
  } catch (error) {
    tracker.failed.push({ file: "transaction-duration.json", reason: (error as Error).message });
  }
  const txRecords = getTransactionDurationLog({ limit: 100, jobId: input.jobId, runId: input.runId });
  safeWriteJson(
    path.join(rootDir, "selectionTimeBudgetBreakdown.json"),
    buildSelectionTimeBudgetBreakdown({
      selectionBudgetMs: Number(input.selectionBudgetMs ?? runtimeSnapshot?.selectionBudgetMs ?? 0),
      durationMs,
      runtimeTimeline: runtimeSnapshot?.timeline as Array<{ at?: string; step?: string; kind?: string }> | undefined,
      txRecords,
    }),
    tracker,
  );
  safeWriteJson(path.join(rootDir, "stage-timings.json"), {
    rejectionCountsByStage,
    pumpScanEvents: getPumpScanLifecycleEvents(20),
    timingSource: "selectionTimeBudgetBreakdown.json",
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
    const scopedSession = {
      ...session,
      terminals: roundTerminals,
      candidates: roundCandidates,
      aiCalls: roundAiCalls ?? [],
      consensus: roundConsensus,
      evAudits: roundEvAudits,
      decisions: roundDecisions,
      riskSizing: roundRiskSizing,
      orders: roundOrders,
      pnlEntries: roundPnl,
      tdiDecisions: roundTdiDecisions ?? [],
      rejectionCountsByStage,
      rejectionCountsByReason,
    };
    const p1Reports = buildP1ForensicReports(scopedSession);
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
      aggregates: p1Reports.entryTimingAggregates,
    }, tracker);
    safeWriteJson(path.join(rootDir, "strategy-performance.json"), p1Reports.strategyPerformance, tracker);
    safeWriteJson(path.join(rootDir, "strategy-regime-matrix.json"), p1Reports.strategyRegimeMatrix, tracker);
    safeWriteJson(path.join(rootDir, "mr-regime-gating-experiment.json"), p1Reports.mrRegimeGatingExperiment, tracker);
    safeWriteJson(path.join(rootDir, "opportunity-funnel.json"), p1Reports.opportunityFunnel, tracker);
    safeWriteJson(path.join(rootDir, "loss-patterns.json"), p1Reports.lossPatterns, tracker);
    safeWriteJson(path.join(rootDir, "winning-patterns.json"), p1Reports.winningPatterns, tracker);
    safeWriteJson(path.join(rootDir, "fee-aware-edge-research.json"), p1Reports.feeAwareEdgeResearch, tracker);
    safeWriteJson(path.join(rootDir, "exit-forensics.json"), p1Reports.exitForensicsReport, tracker);
    safeWriteJson(path.join(rootDir, "replay-exit-diagnostics.json"), p1Reports.replayExitDiagnostics, tracker);
    safeWriteJson(path.join(rootDir, "replayExitDiagnostics.json"), p1Reports.replayExitDiagnostics, tracker);
    safeWriteJson(path.join(rootDir, "gross-positive-net-negative.json"), {
      rows: p1Reports.grossPositiveNetNegative ?? [],
    }, tracker);
    safeWriteJson(path.join(rootDir, "fee-by-strategy.json"), {
      rows: p1Reports.feeByStrategy ?? [],
    }, tracker);
    safeWriteJson(path.join(rootDir, "fee-by-hold-time.json"), {
      rows: p1Reports.feeByHoldTime ?? [],
    }, tracker);
    safeWriteJson(path.join(rootDir, "exit-fee-interaction.json"), {
      rows: p1Reports.exitFeeInteraction ?? [],
    }, tracker);
    safeWriteJson(path.join(rootDir, "p1-promotion-gate.json"), p1Reports.promotionGate, tracker);

    const p2Reports = buildP2ForensicReports(scopedSession);
    const normalizedTdiDecisions = p2Reports.tdiDecisions.map((row) => normalizeTdiDecisionRecord(row));
    const runtimeTdiApproved = normalizedTdiDecisions.filter((row) => row.verdict === "APPROVED").length;
    const runtimeTdiWait = normalizedTdiDecisions.filter((row) => row.verdict === "WAIT").length;
    const runtimeTdiRejected = normalizedTdiDecisions.filter((row) => row.verdict === "REJECTED").length;
    const tdiDataQuality = buildTdiDataQualityArtifacts(normalizedTdiDecisions);
    safeWriteJson(
      path.join(rootDir, "tdi-decisions.json"),
      {
        schemaVersion: TDI_DECISION_SCHEMA_VERSION,
        records: normalizedTdiDecisions,
      },
      tracker,
    );
    safeWriteJson(path.join(rootDir, "tdi-data-quality.json"), tdiDataQuality, tracker);
    safeWriteJson(path.join(rootDir, "tdi-input-contract.json"), { rows: tdiDataQuality.inputContracts }, tracker);
    safeWriteJson(path.join(rootDir, "tdi-missing-telemetry-report.json"), tdiDataQuality.missingTelemetryReport, tracker);
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
    safeWriteJson(path.join(rootDir, "baseline-metrics.json"), p2Reports.baselineMetrics, tracker);
    safeWriteJson(path.join(rootDir, "out-of-sample-evaluation.json"), p2Reports.outOfSampleEvaluation, tracker);
    safeWriteJson(path.join(rootDir, "profit-concentration.json"), p2Reports.profitConcentration, tracker);
    safeWriteJson(path.join(rootDir, "candidate-quality-factors.json"), p2Reports.candidateQualityFactors, tracker);
    safeWriteJson(path.join(rootDir, "trend-following-validation.json"), p2Reports.trendFollowingValidation, tracker);
    safeWriteJson(path.join(rootDir, "single-change-experiments.json"), {
      experiments: p2Reports.singleChangeExperiments,
    }, tracker);
    safeWriteCsv(
      path.join(rootDir, "strategy-regime-matrix-p2.csv"),
      buildStrategyRegimeMatrixCsv(p2Reports.strategyRegimeMatrix),
      tracker,
    );
    safeWriteCsv(
      path.join(rootDir, "profitability-experiments.csv"),
      buildProfitabilityExperimentsCsv(p2Reports.experimentRegistry),
      tracker,
    );

    summary.funnelState = {
      ...summary.funnelState,
      tdiDecisions: p2Reports.tdiDecisions.length,
      scannerQualificationRejections: p1Reports.scannerQualificationRejections.length,
      runtimeTdiApproved,
      runtimeTdiWait,
      runtimeTdiRejected,
      upstreamCandidateRejected: Number(rejectionCountsByReason.SCANNER_REJECT ?? 0),
      hybridRejected: Number(rejectionCountsByReason.TDI_REJECTED ?? 0),
      consensusRejected: Number(rejectionCountsByReason.CONSENSUS_REJECT ?? 0),
      masterRejected: Number(rejectionCountsByReason.AI_REJECTED ?? 0),
    };
    summary.artifactRefs = refs;
    safeWriteJson(path.join(rootDir, "round-summary.json"), summary, tracker);
  } catch (error) {
    tracker.failed.push({ file: "p1-p2-reports", reason: (error as Error).message });
    summary.artifactRefs = refs;
    summary.exportStatus = tracker.failed.length > 0 ? "PARTIAL" : "COMPLETED";
    safeWriteJson(path.join(rootDir, "round-summary.json"), summary, tracker);
  }

  const required = [
    "round-summary.json",
    "round-liveness.json",
    "recovery-decisions.json",
    "recovery-telemetry.json",
    "pnl-ledger.json",
    "fee-aware-entry-policy.json",
    "exit-forensics.json",
    "replay-exit-diagnostics.json",
    "tdi-data-quality.json",
    "tdi-input-contract.json",
    "tdi-missing-telemetry-report.json",
  ];
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
