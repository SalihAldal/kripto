import { randomUUID } from "node:crypto";
import { consensusVoteLabel } from "@/src/server/ai/ai-provider-health.service";
import type { AIConsensusResult, AIProviderResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import {
  createCandidateId,
  finishScannerCycle,
  recordAiCall,
  recordCandidateTrace,
  recordConsensusAudit,
  recordDecisionTrace,
  recordEvAudit,
  recordPaperOrder,
  recordPnlLedgerEntry,
  recordRiskSizingTrace,
  recordScannerSymbol,
  recordMeanReversionEntry,
  recordScannerQualificationRejections,
  recordNotDiscoveredAnalysis,
  recordEntryTiming,
  recordScannerUniverseSnapshot,
  recordScannerCoverageSnapshot,
  recordTdiDecision,
  recordFeePolicyEvaluation,
  startScannerCycle,
} from "@/src/server/forensics/forensic-collector.service";
import { buildTdiDecisionRecord } from "@/src/server/forensics/tdi-decision-forensics.service";
import { recordCandidateFunnelStage } from "@/src/server/forensics/candidate-funnel-trace.service";
import { evaluateFeeAwareEntryPolicy } from "@/src/server/forensics/fee-aware-entry-policy.service";
import { runWithForensicSession, setForensicSession } from "@/src/server/forensics/forensic-context";
import type {
  AiExecutionMode,
  AiCallAudit,
  ForensicSessionContext,
  ScannerDecisionObservabilityInput,
} from "@/src/server/forensics/forensic.types";
import { buildEntryTimingRecord } from "@/src/server/forensics/entry-timing-forensics.service";
import {
  buildMeanReversionEntryRecord,
  isMeanReversionStrategy,
} from "@/src/server/forensics/mean-reversion-regime-audit.service";
import { analyzePostEntryNotDiscovered } from "@/src/server/forensics/p1-forensic-report.service";
import { buildScannerQualificationRejections } from "@/src/server/forensics/scanner-qualification-forensics.service";
import { classifyForensicRegime, estimateTrendStrength } from "@/src/server/forensics/regime-classifier.service";
import { createPnlLedgerEntry } from "@/src/server/forensics/pnl-ledger.service";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";
import {
  attachSessionState,
  createPaperSessionSnapshot,
  transitionPaperSession,
} from "@/src/server/forensics/paper-session-state.service";

export function beginForensicPaperSession(input: {
  sessionId?: string;
  jobId?: string;
  runId?: string;
  roundId?: string;
  roundNo?: number;
}) {
  const sessionId = input.sessionId ?? input.jobId ?? `paper-${randomUUID()}`;
  const session: ForensicSessionContext = {
    sessionId,
    jobId: input.jobId,
    runId: input.runId,
    roundId: input.roundId,
    mode: "paper",
    startedAt: new Date().toISOString(),
    terminals: [],
    scannerCycles: [],
    candidates: [],
    aiCalls: [],
    consensus: [],
    evAudits: [],
    decisions: [],
    riskSizing: [],
    orders: [],
    pnlEntries: [],
    meanReversionEntries: [],
    scannerQualificationRejections: [],
    notDiscoveredRecords: [],
    entryTimingRecords: [],
    scannerCoverageSnapshots: [],
    tdiDecisions: [],
    feePolicyEvaluations: [],
    rejectionCountsByStage: {},
    rejectionCountsByReason: {},
    sessionState: createPaperSessionSnapshot({
      sessionId,
      roundId: input.roundId,
      currentRound: input.roundNo,
      status: input.roundId ? "ROUND_INITIALIZING" : "CREATED",
    }),
  };
  startScannerCycle();
  setForensicSession(session);
  return session;
}

export async function withForensicPaperSession<T>(
  input: Parameters<typeof beginForensicPaperSession>[0],
  fn: () => Promise<T>,
) {
  const session = beginForensicPaperSession(input);
  try {
    attachSessionState(session, transitionPaperSession(session.sessionState!, "RUNNING_ROUND"));
    return await runWithForensicSession(session, fn);
  } finally {
    finishScannerCycle();
    attachSessionState(session, transitionPaperSession(session.sessionState!, "COMPLETED"));
  }
}

export function bridgeScannerObservability(input: ScannerDecisionObservabilityInput) {
  const candidateId = input.rejectTelemetry?.candidateId ?? createCandidateId(input.symbol, "scanner");
  const reasonCode =
    input.rejectTelemetry?.rejectReasonCode ??
    (input.status === "QUALIFIED" || input.status === "PASS" ? "QUALIFIED" : input.reasons[0] ?? input.status);
  recordScannerSymbol({
    symbol: input.symbol,
    market: "binance-tr",
    quote: "TRY",
    qualification: input.status === "PASS" || input.status === "QUALIFIED" ? "APPROVED" : "REJECTED",
    reasonCode,
    volume: Number(input.metrics?.volume24h ?? 0),
    liquidity: Number(input.metrics?.liquidityScore ?? 0),
    price: Number(input.metrics?.lastPrice ?? 0),
    change24h: Number(input.metrics?.change24h ?? 0),
    marketRegime: String(input.contextMetadata?.regime ?? input.contextMetadata?.marketRegime ?? ""),
  });
  recordCandidateTrace({
    candidateId,
    symbol: input.symbol,
    strategyScore: input.scannerScore,
    marketContext: input.contextMetadata,
    technicalInputs: input.metrics,
    source: "scanner",
    ranking: input.scannerConfidence,
  });
}

export function bridgeAiProviderResult(input: {
  candidateId?: string;
  symbol: string;
  provider: string;
  model?: string | null;
  latencyMs: number;
  ok: boolean;
  remote: boolean;
  degraded?: boolean;
  healthState?: string;
  reason?: string;
  healthBefore?: string;
  healthAfter?: string;
  requestStartedAt?: string;
  requestEndedAt?: string;
  responseReceived?: boolean;
  errorCode?: string;
  errorType?: string;
  retryCount?: number;
  finalHealth?: string;
}) {
  const healthState = input.healthState ?? (input.ok && input.remote ? "HEALTHY" : input.degraded ? "DEGRADED" : "UNAVAILABLE");
  const executionMode: AiExecutionMode =
    healthState === "HEALTHY" && input.remote
      ? "REMOTE"
      : healthState === "DEGRADED"
        ? "AI_DEGRADED"
        : "DEGRADED_LOCAL";
  const policyFailure = ["TIMEOUT", "UNAVAILABLE", "INVALID_RESPONSE", "RATE_LIMITED", "ABORTED"].includes(healthState);
  const audit: AiCallAudit = {
    callId: randomUUID(),
    candidateId: input.candidateId,
    symbol: input.symbol,
    executionMode,
    provider: input.provider,
    model: input.model,
    timestamp: input.requestEndedAt ?? new Date().toISOString(),
    latencyMs: input.latencyMs,
    remote: executionMode === "REMOTE",
    success: executionMode === "REMOTE",
    degraded: executionMode !== "REMOTE",
    healthState,
    reason: input.reason,
    healthBefore: input.healthBefore,
    healthAfter: input.healthAfter ?? healthState,
    requestStartedAt: input.requestStartedAt,
    requestEndedAt: input.requestEndedAt,
    responseReceived: input.responseReceived ?? executionMode === "REMOTE",
    errorCode: input.errorCode,
    errorType: input.errorType,
    retryCount: input.retryCount,
    finalHealth: input.finalHealth ?? healthState,
    reasonCode:
      executionMode === "REMOTE"
        ? "REMOTE_OK"
        : policyFailure
          ? `AI_PROVIDER_${healthState}`
          : "DEGRADED_FALLBACK",
    reasonDetail: input.reason,
  };
  recordAiCall(audit);
  return audit;
}

export function bridgeConsensusResult(input: {
  symbol: string;
  consensus: AIConsensusResult;
  providers: AIProviderResult[];
  masterRuleId?: string;
  providerHealthGate?: string;
}) {
  const providerVotes: Record<string, string> = {};
  const weights: Record<string, number> = {};
  for (const row of input.providers) {
    providerVotes[row.providerId] = consensusVoteLabel(row);
    weights[row.providerId] = row.weight ?? 1;
  }
  const reasonSuffix = input.providerHealthGate ? ` | providerHealthGate=${input.providerHealthGate}` : "";
  return recordConsensusAudit({
    consensusId: randomUUID(),
    symbol: input.symbol,
    providerVotes,
    weights,
    confidence: input.consensus.finalConfidence,
    masterRuleId: input.masterRuleId,
    finalDecision: input.consensus.finalDecision,
    reason: `${input.consensus.explanation ?? ""}${reasonSuffix}`,
    timestamp: new Date().toISOString(),
  });
}

export function bridgeHybridEv(input: {
  candidateId: string;
  symbol: string;
  expectedValue?: number | null;
  threshold?: number;
  winProbability?: number;
  expectedProfit?: number;
  expectedLoss?: number;
  fees?: number;
  expectedRiskReward?: number | null;
  verdict: "APPROVED" | "WAIT" | "REJECTED" | "UNKNOWN";
  reasonCode: string;
}) {
  return recordEvAudit({
    candidateId: input.candidateId,
    symbol: input.symbol,
    formulaVersion: "hybrid-v1",
    winProbability: input.winProbability,
    expectedProfit: input.expectedProfit,
    expectedLoss: input.expectedLoss,
    fees: input.fees,
    expectedRiskReward: input.expectedRiskReward ?? undefined,
    expectedValue: input.expectedValue ?? undefined,
    threshold: input.threshold,
    verdict: input.verdict,
    reasonCode: input.reasonCode,
    timestamp: new Date().toISOString(),
  });
}

export function bridgeExecutionDecision(input: {
  candidateId: string;
  symbol: string;
  approved: boolean;
  reasonCode: string;
  reasonDetail: string;
  stage?: "decision" | "execution";
  rank?: number;
  score?: number;
}) {
  return recordDecisionTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: input.stage ?? "decision",
    verdict: input.approved ? "APPROVE" : "REJECT",
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    rank: input.rank,
    score: input.score,
  });
}

export function bridgeRiskSizing(input: {
  candidateId: string;
  symbol: string;
  approved: boolean;
  requestedSize?: number;
  computedSize?: number;
  availableBalance?: number;
  maxSimultaneousPositions?: number;
  finalQuantity?: number;
  rejectionReason?: string;
  riskParameters?: Record<string, unknown>;
}) {
  return recordRiskSizingTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    riskVerdict: input.approved ? "APPROVED" : "REJECTED",
    riskParameters: input.riskParameters,
    requestedSize: input.requestedSize,
    computedSize: input.computedSize,
    availableBalance: input.availableBalance,
    maxSimultaneousPositions: input.maxSimultaneousPositions,
    finalQuantity: input.finalQuantity,
    rejectionReason: input.rejectionReason,
    timestamp: new Date().toISOString(),
  });
}

export function bridgePaperFill(input: {
  candidateId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  quantity: number;
  fees: number;
  orderId?: string;
  fillId?: string;
  positionId?: string;
  roundId?: string;
  sessionId?: string;
  reconciled?: boolean;
  reconcileError?: string;
}) {
  return recordPaperOrder({
    ...input,
    exchange: "binance-tr-simulator",
    executionMode: "paper",
    timestamp: new Date().toISOString(),
    reconciled: input.reconciled ?? Boolean(input.orderId && input.fillId && input.positionId),
  });
}

export function bridgeClosedTradePnl(input: {
  tradeId: string;
  positionId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  entryFee: number;
  exitFee: number;
  slippageCost?: number;
  roundId?: string;
  sessionId?: string;
  exitReason?: Parameters<typeof createPnlLedgerEntry>[0]["exitReason"];
  exitModel?: Parameters<typeof createPnlLedgerEntry>[0]["exitModel"];
  exitForensics?: Parameters<typeof createPnlLedgerEntry>[0]["exitForensics"];
}) {
  return recordPnlLedgerEntry(createPnlLedgerEntry(input));
}

export function bridgeAiExecutionGate(input: {
  candidateId?: string;
  symbol: string;
  aiVerdict: string;
  aiFinalDecision?: string;
  consensusDecision?: string | null;
  aiGatePolicy?: import("@/src/server/forensics/forensic.types").AiExecutionGatePolicy;
  aiGateVerdict?: import("@/src/server/forensics/forensic.types").AiExecutionGateVerdict;
  executionVerdict: import("@/src/server/forensics/forensic.types").AiExecutionGateVerdict;
  policy: import("@/src/server/forensics/forensic.types").AiExecutionGatePolicy;
  reasonCode: string;
  reasonDetail: string;
  executionSide?: "BUY" | "SELL" | null;
}) {
  const candidateId = input.candidateId ?? createCandidateId(input.symbol, "execution");
  const aiFinalDecision = input.aiFinalDecision ?? input.aiVerdict;
  const aiGatePolicy = input.aiGatePolicy ?? input.policy;
  const aiGateVerdict = input.aiGateVerdict ?? input.executionVerdict;
  return recordDecisionTrace({
    candidateId,
    symbol: input.symbol,
    stage: "execution",
    verdict:
      input.executionVerdict === "AI_GATE_BLOCK"
        ? "REJECT"
        : input.executionVerdict === "AI_ADVISORY_ONLY"
          ? "WAIT"
          : "APPROVE",
    reasonCode: input.reasonCode,
    reasonDetail: JSON.stringify({
      aiVerdict: input.aiVerdict,
      aiFinalDecision,
      consensusDecision: input.consensusDecision ?? null,
      aiGatePolicy,
      aiGateVerdict,
      executionVerdict: input.executionVerdict,
      executionSide: input.executionSide ?? null,
      detail: input.reasonDetail,
    }),
  });
}

export function bridgeFeeEdgeMetrics(input: {
  candidateId: string;
  symbol: string;
  metrics: import("@/src/server/forensics/forensic.types").FeeEdgeMetricsSnapshot;
}) {
  return recordDecisionTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: "ev",
    verdict: "APPROVE",
    reasonCode: "FEE_EDGE_METRICS",
    reasonDetail: JSON.stringify(input.metrics),
  });
}

export function bridgeExecutionCandidateForensic(input: import("@/src/server/forensics/forensic.types").ExecutionCandidateForensic) {
  return recordDecisionTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: "execution",
    verdict:
      input.executionVerdict === "AI_GATE_BLOCK" || input.executionVerdict === "REJECTED"
        ? "REJECT"
        : input.executionVerdict === "AI_ADVISORY_ONLY"
          ? "WAIT"
          : "APPROVE",
    reasonCode: input.reasonCode ?? "EXECUTION_CANDIDATE",
    reasonDetail: JSON.stringify({
      aiVerdict: input.aiVerdict,
      executionVerdict: input.executionVerdict,
      riskVerdict: input.riskVerdict,
      sizingVerdict: input.sizingVerdict,
      orderVerdict: input.orderVerdict,
      feeEstimate: input.feeEstimate,
      detail: input.reasonDetail,
    }),
  });
}

export function bridgeCandidateFromScanner(input: ScannerCandidate, rank: number) {
  const candidateId = createCandidateId(input.context.symbol, "scanner");
  const meta = input.context.metadata as Record<string, unknown>;
  const strategyId =
    typeof meta.regime === "object" && meta.regime !== null && typeof (meta.regime as Record<string, unknown>).selectedStrategy === "string"
      ? ((meta.regime as Record<string, unknown>).selectedStrategy as string)
      : undefined;
  recordCandidateTrace({
    candidateId,
    symbol: input.context.symbol,
    strategyId,
    strategyScore: Number(input.score.score ?? 0),
    marketContext: input.context as unknown as Record<string, unknown>,
    technicalInputs: input.score.metrics as unknown as Record<string, unknown>,
    source: "scanner",
    ranking: rank,
  });
  return candidateId;
}

export function bridgeScannerUniverseSnapshot(input: { watchlist: string[]; cycleSymbols: string[] }) {
  return recordScannerUniverseSnapshot(input);
}

export function bridgeScannerCoverageSnapshot(
  input: import("@/src/server/forensics/forensic.types").ScannerCoverageSnapshot,
) {
  return recordScannerCoverageSnapshot(input);
}

export function bridgeScannerQualificationForensics(input: {
  context: MarketContext;
  score: ScannerScore;
  inCycle: boolean;
  inUniverse: boolean;
  ranked: boolean;
  aiScope: boolean;
}) {
  const rejections = buildScannerQualificationRejections(input);
  if (rejections.length > 0) {
    recordScannerQualificationRejections(rejections);
  }
  return rejections;
}

export function bridgePostEntryNotDiscovered(input: {
  symbol: string;
  subsequentMovePercent?: number;
  watchlist: string[];
  cycleSymbols: string[];
  context?: MarketContext | null;
  score?: ScannerScore | null;
  ranked?: boolean;
  aiScope?: boolean;
}) {
  const record = analyzePostEntryNotDiscovered(input);
  return recordNotDiscoveredAnalysis(record);
}

export function bridgeMeanReversionEntry(input: {
  candidateId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  strategyId: string;
  strategySelectionReason: string;
  marketRegime: string;
  volatilityPercent: number;
  volume24h: number;
  spreadPercent: number;
  momentumPercent: number;
  shortMomentumPercent: number;
  liquidityScore: number;
  entryPrice: number;
  candidateTimestamp?: string;
  decisionTimestamp?: string;
  tradeId?: string;
  metadata?: Record<string, unknown>;
}) {
  if (!isMeanReversionStrategy(input.strategyId)) return null;
  const forensicRegime = classifyForensicRegime({
    marketRegime: input.marketRegime,
    volatilityPercent: input.volatilityPercent,
    volume24h: input.volume24h,
    spreadPercent: input.spreadPercent,
    trendStrength: estimateTrendStrength({
      momentumPercent: input.momentumPercent,
      shortMomentumPercent: input.shortMomentumPercent,
      marketRegime: input.marketRegime,
    }),
  });
  return recordMeanReversionEntry(
    buildMeanReversionEntryRecord({
      ...input,
      forensicRegime,
      trendStrength: estimateTrendStrength({
        momentumPercent: input.momentumPercent,
        shortMomentumPercent: input.shortMomentumPercent,
        marketRegime: input.marketRegime,
      }),
    }),
  );
}

export function bridgeEntryTimingForensics(input: {
  candidateId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  candidateTimestamp?: string;
  decisionTimestamp?: string;
  entryTimestamp?: string;
  priceAtCandidate?: number;
  priceAtDecision?: number;
  priceAtEntry: number;
}) {
  return recordEntryTiming(
    buildEntryTimingRecord({
      ...input,
      entryTimestamp: input.entryTimestamp ?? new Date().toISOString(),
    }),
  );
}

export function bridgeStrategyDecision(input: {
  candidateId: string;
  symbol: string;
  strategyId: string;
  approved: boolean;
  reasonCode: string;
  reasonDetail: string;
}) {
  return recordDecisionTrace({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: "strategy",
    verdict: input.approved ? "APPROVE" : "REJECT",
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
  });
}

export function bridgeTdiDecision(input: Parameters<typeof buildTdiDecisionRecord>[0]) {
  const record = buildTdiDecisionRecord(input);
  recordCandidateFunnelStage({
    candidateId: input.candidateId,
    symbol: input.symbol,
    stage: "tdi",
    verdict: record.verdict,
    reasonCode: record.reasonCode ?? "TDI_EVALUATED",
    reasonDetail: record.reasonDetail ?? `TDI ${record.verdict}`,
    metadata: {
      tdiEntered: true,
      hybridDecision: record.hybridDecision,
      firstBlockingCondition: record.firstBlockingCondition,
    },
  });
  return recordTdiDecision(record);
}

export function bridgeFeeAwareEntryPolicy(input: {
  candidateId: string;
  symbol: string;
  metrics: import("@/src/server/forensics/forensic.types").FeeEdgeMetricsSnapshot;
  blockingEnabled?: boolean;
}) {
  const evaluation = evaluateFeeAwareEntryPolicy({
    metrics: input.metrics,
    blockingEnabled: input.blockingEnabled ?? false,
  });
  return recordFeePolicyEvaluation({
    ...evaluation,
    candidateId: input.candidateId,
    symbol: input.symbol,
  });
}
