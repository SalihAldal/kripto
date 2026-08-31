import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import {
  appendDecisionTimeline,
  getActiveDecisionTrace,
  isDecisionPersistenceDeferred,
  mergeDecisionFeatures,
  mergeDecisionMetadata,
  mergeDecisionRejectReasons,
  mergeDecisionScores,
  runWithDecisionTrace,
  setDecisionMarketState,
  setDecisionStrategyUsed,
  takeActiveDecisionTrace,
} from "@/src/server/observability/decision-trace-context";
import {
  buildHumanDecisionSummary,
  categorizeRejectReason,
  extractFeatureSnapshotFromAiInput,
  extractFeatureSnapshotFromCandidate,
  extractRejectReasonsFromAi,
  extractRejectReasonsFromQualityGate,
  extractRejectReasonsFromScanner,
  extractScoresFromAi,
  extractScoresFromCandidate,
  rankRejectReasons,
} from "@/src/server/observability/decision-observability.helpers";
import type {
  AiDecisionObservabilityInput,
  BeginDecisionTraceInput,
  DecisionTimelineInput,
  ExecutionDecisionObservabilityInput,
  FinalizeDecisionLogInput,
  QualityGateObservabilityInput,
  RejectReasonInput,
  ScannerDecisionObservabilityInput,
} from "@/src/server/observability/decision-observability.types";
import type { AIConsensusResult } from "@/src/types/ai";
import {
  bridgeExecutionDecision,
  bridgeRiskSizing,
  bridgeScannerObservability,
} from "@/src/server/forensics/forensic-bridge.service";
import { createCandidateId } from "@/src/server/forensics/forensic-collector.service";
import {
  appendDecisionTimelineEvents,
  listDecisionLogs,
  getDecisionLogByDecisionId,
  upsertDecisionLogRecord,
} from "@/src/server/repositories/decision-log.repository";

const JSON_SANITIZE_MAX_DEPTH = 6;
const JSON_SANITIZE_MAX_KEYS = 80;
const JSON_SANITIZE_MAX_ARRAY = 80;

function toSafeJsonValue(
  value: unknown,
  depth = 0,
  seen?: WeakSet<object>,
): Prisma.InputJsonValue {
  if (value == null) return "[NULL]";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return Number(value);
  if (depth >= JSON_SANITIZE_MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) {
    return value
      .slice(0, JSON_SANITIZE_MAX_ARRAY)
      .map((row) => toSafeJsonValue(row, depth + 1, seen));
  }
  if (typeof value !== "object") return String(value);
  const ref = value as Record<string, unknown>;
  const localSeen = seen ?? new WeakSet<object>();
  if (localSeen.has(ref)) return "[CIRCULAR_REF]";
  localSeen.add(ref);
  const entries = Object.entries(ref).slice(0, JSON_SANITIZE_MAX_KEYS);
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, row] of entries) {
    out[key] = toSafeJsonValue(row, depth + 1, localSeen);
  }
  return out;
}

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return toSafeJsonValue(value);
}

function safeObserve(promise: Promise<unknown>) {
  void promise.catch((error) => {
    logger.warn({ error: (error as Error).message }, "Decision observability persistence failed");
  });
}

export function createDecisionId() {
  return randomUUID();
}

export function beginDecisionTrace(input: BeginDecisionTraceInput) {
  const trace = {
    decisionId: input.decisionId,
    analysisId: input.analysisId ?? input.decisionId,
    symbol: input.symbol.toUpperCase(),
    deferPersistence: Boolean(input.deferPersistence),
    timeline: [] as DecisionTimelineInput[],
    rejectReasons: [] as RejectReasonInput[],
    scores: {},
    metadata: input.source ? { source: input.source } : undefined,
  };
  appendDecisionTimeline({
    stage: "SCANNER",
    outcome: "STARTED",
    message: `Decision trace started for ${trace.symbol}`,
    details: { decisionId: trace.decisionId, analysisId: trace.analysisId, source: input.source ?? null },
  });
  return trace;
}

export function recordDecisionTimelineEvent(input: DecisionTimelineInput) {
  appendDecisionTimeline(input);
  const trace = getActiveDecisionTrace();
  if (!trace || trace.deferPersistence) return;
  const stepOrder = trace.timeline.length;
  safeObserve(
    appendDecisionTimelineEvents(trace.decisionId, [
      {
        stage: input.stage,
        stepOrder,
        outcome: input.outcome,
        message: input.message ?? null,
        details: asJson(input.details),
      },
    ]),
  );
}

export function observeScannerDecision(input: ScannerDecisionObservabilityInput) {
  const rejectReasons = extractRejectReasonsFromScanner(input.reasons);
  mergeDecisionRejectReasons(rejectReasons);
  mergeDecisionScores({
    scannerScore: input.scannerScore,
    confidence: input.scannerConfidence,
  });
  if (input.contextMetadata) {
    setDecisionMarketState(input.contextMetadata);
  }
  mergeDecisionMetadata({
    scannerStatus: input.status,
    scannerMetrics: input.metrics ?? null,
    scannerRejectTelemetry: input.rejectTelemetry ?? null,
    scannerSpreadMomentumShadow: input.spreadMomentumShadow ?? null,
  });
  const exactReasonCode =
    input.rejectTelemetry?.rejectReasonCode ??
    (input.status === "QUALIFIED" || input.status === "PASS" ? "QUALIFIED" : "GENERIC_REJECTED");
  const exactReasonDetail =
    input.rejectTelemetry?.rejectReasonDetail ??
    (input.reasons.length > 0 ? input.reasons.join(" | ") : `Scanner status=${input.status}`);
  recordDecisionTimelineEvent({
    stage: "SCANNER",
    outcome: input.status,
    message: exactReasonDetail,
    details: {
      scannerScore: input.scannerScore,
      scannerConfidence: input.scannerConfidence,
      reasons: input.reasons,
      metrics: input.metrics ?? null,
      rejectTelemetry: input.rejectTelemetry ?? null,
      spreadMomentumShadow: input.spreadMomentumShadow ?? null,
      rejectReasonCode: exactReasonCode,
      rejectReasonDetail: exactReasonDetail,
    },
  });
  bridgeScannerObservability(input);
  if (input.status !== "QUALIFIED" && input.status !== "PASS") {
    const rejectStage: "decision" | "execution" =
      input.rejectTelemetry?.rejectStage === "execution" ? "execution" : "decision";
    bridgeExecutionDecision({
      candidateId: input.rejectTelemetry?.candidateId ?? createCandidateId(input.symbol, "scanner"),
      symbol: input.symbol,
      approved: false,
      reasonCode: exactReasonCode,
      reasonDetail: exactReasonDetail,
      stage: rejectStage,
      score: input.scannerScore,
    });
  }

  if (isDecisionPersistenceDeferred()) return;

  const ranked = rankRejectReasons(rejectReasons);
  safeObserve(
    upsertDecisionLogRecord({
      decisionId: input.decisionId,
      analysisId: input.decisionId,
      symbol: input.symbol,
      scannerScore: input.scannerScore,
      confidence: input.scannerConfidence,
      decision: input.status === "QUALIFIED" ? "HOLD" : "REJECT",
      executionAllowed: false,
      rejectReasons: ranked.map((row) => row.reason),
      reasonWeights: Object.fromEntries(ranked.map((row) => [row.reason, row.weight])),
      humanSummary: buildHumanDecisionSummary({
        symbol: input.symbol,
        decision: input.status,
        executionAllowed: false,
        topReasons: ranked,
        confidence: input.scannerConfidence,
      }),
      rejectReasonRows: ranked,
      marketState: asJson(input.contextMetadata),
      metadata: asJson({ scannerOnly: true, metrics: input.metrics ?? null }),
      timeline: [
        {
          stage: "SCANNER",
          stepOrder: 1,
          outcome: input.status,
          message: input.reasons.join(" | ") || undefined,
          details: { scannerScore: input.scannerScore, reasons: input.reasons },
        },
      ],
    }),
  );
}

export function observeAiDecision(input: AiDecisionObservabilityInput) {
  const rejectReasons = extractRejectReasonsFromAi(input.result);
  const scores = extractScoresFromAi(input.result, input.scannerScore);
  const features = extractFeatureSnapshotFromAiInput(input.input, input.result);

  mergeDecisionRejectReasons(rejectReasons);
  mergeDecisionScores(scores);
  mergeDecisionFeatures(features);
  if (input.input.marketRegime) {
    setDecisionMarketState(input.input.marketRegime as unknown as Record<string, unknown>);
  }
  if (input.input.marketRegime?.selectedStrategy) {
    setDecisionStrategyUsed(input.input.marketRegime.selectedStrategy);
  }
  mergeDecisionMetadata({
    aiExplanation: input.result.explanation,
    aiRejected: input.result.rejected ?? false,
  });

  recordDecisionTimelineEvent({
    stage: "AI",
    outcome: input.result.finalDecision,
    message: input.result.explanation,
    details: {
      confidence: input.result.finalConfidence,
      riskScore: input.result.finalRiskScore,
      rejectReason: input.result.rejectReason ?? null,
      noTradeReasonList: (input.result as AIConsensusResult & { noTradeReasonList?: string[] }).noTradeReasonList ?? [],
    },
  });

  if (isDecisionPersistenceDeferred()) return;

  const ranked = rankRejectReasons(rejectReasons);
  const executionAllowed = input.result.finalDecision === "BUY";
  safeObserve(
    upsertDecisionLogRecord({
      decisionId: input.decisionId,
      analysisId: input.decisionId,
      symbol: input.symbol,
      ...scores,
      decision: input.result.finalDecision,
      executionAllowed,
      strategyUsed: input.input.marketRegime?.selectedStrategy ?? null,
      rejectReasons: ranked.map((row) => row.reason),
      reasonWeights: Object.fromEntries(ranked.map((row) => [row.reason, row.weight])),
      humanSummary: buildHumanDecisionSummary({
        symbol: input.symbol,
        decision: input.result.finalDecision,
        executionAllowed,
        topReasons: ranked,
        confidence: input.result.finalConfidence,
      }),
      rejectReasonRows: ranked,
      features,
      marketState: asJson(input.input.marketRegime),
      metadata: asJson({
        aiOnly: true,
        explanation: input.result.explanation,
      }),
      timeline: [
        { stage: "AI", stepOrder: 1, outcome: input.result.finalDecision, message: input.result.explanation },
        {
          stage: "EVALUATION",
          stepOrder: 2,
          outcome: executionAllowed ? "PASS" : "REJECT",
          message: input.result.rejectReason ?? input.result.explanation,
        },
      ],
    }),
  );
}

export function observeQualityGateDecision(input: QualityGateObservabilityInput) {
  const rejectReasons = extractRejectReasonsFromQualityGate(input.qualityGate);
  mergeDecisionRejectReasons(rejectReasons);
  mergeDecisionScores({
    confidence: input.qualityGate.weightedTotal,
  });
  mergeDecisionMetadata({
    qualityGate: {
      decision: input.qualityGate.decision,
      qualityScore: input.qualityGate.qualityScore,
      minimumRequiredScore: input.qualityGate.minimumRequiredScore,
      criteriaScores: input.qualityGate.criteriaScores,
      whyRejected: input.qualityGate.whyRejected,
      whyAccepted: input.qualityGate.whyAccepted,
    },
  });
  recordDecisionTimelineEvent({
    stage: "DECISION_ENGINE",
    outcome: input.qualityGate.decision,
    message: input.qualityGate.whyRejected.join(" | ") || input.qualityGate.whyAccepted.join(" | "),
    details: {
      qualityScore: input.qualityGate.qualityScore,
      minimumRequiredScore: input.qualityGate.minimumRequiredScore,
      criteriaScores: input.qualityGate.criteriaScores,
    },
  });
}

export function observeRiskGateDecision(input: {
  decisionId: string;
  symbol: string;
  outcome: string;
  message: string;
  details?: Record<string, unknown>;
}) {
  if (input.message) {
    mergeDecisionRejectReasons([categorizeRejectReason(input.message, 0.9)]);
  }
  recordDecisionTimelineEvent({
    stage: "RISK_ENGINE",
    outcome: input.outcome,
    message: input.message,
    details: input.details,
  });
  bridgeRiskSizing({
    candidateId: createCandidateId(input.symbol, "risk"),
    symbol: input.symbol,
    approved: input.outcome === "PASS" || input.outcome === "APPROVED",
    rejectionReason: input.outcome === "PASS" || input.outcome === "APPROVED" ? undefined : input.message,
    riskParameters: input.details,
  });
}

export function observeTradeDecision(input: {
  decisionId: string;
  symbol: string;
  outcome: string;
  message?: string;
  details?: Record<string, unknown>;
}) {
  recordDecisionTimelineEvent({
    stage: "TRADE",
    outcome: input.outcome,
    message: input.message,
    details: input.details,
  });
}

export async function finalizeDecisionLog(input: FinalizeDecisionLogInput) {
  const trace = takeActiveDecisionTrace();
  const rejectReasons = rankRejectReasons([...(trace?.rejectReasons ?? []), ...(input.rejectReasons ?? [])]);
  const scores = { ...(trace?.scores ?? {}), ...(input.scores ?? {}) };
  const features = trace?.features ?? input.features;
  const timeline = trace?.timeline ?? [];
  if (timeline.length === 0 || timeline[timeline.length - 1]?.stage !== "EVALUATION") {
    timeline.push({
      stage: "EVALUATION",
      outcome: input.executionAllowed ? "PASS" : "REJECT",
      message: input.humanSummary,
      details: input.metadata,
    });
  }

  const humanSummary =
    input.humanSummary ??
    buildHumanDecisionSummary({
      symbol: input.symbol,
      decision: input.decision,
      executionAllowed: input.executionAllowed,
      topReasons: rejectReasons,
      confidence: scores.confidence ?? null,
    });

  await upsertDecisionLogRecord({
    decisionId: input.decisionId,
    analysisId: input.analysisId ?? trace?.analysisId ?? input.decisionId,
    symbol: input.symbol,
    ...scores,
    decision: input.decision,
    executionAllowed: input.executionAllowed,
    humanSummary,
    rejectReasons: rejectReasons.map((row) => row.reason),
    reasonWeights: Object.fromEntries(rejectReasons.map((row) => [row.reason, row.weight])),
    strategyUsed: input.strategyUsed ?? trace?.strategyUsed ?? null,
    marketState: asJson(input.marketState ?? trace?.marketState),
    metadata: asJson({ ...(trace?.metadata ?? {}), ...(input.metadata ?? {}) }),
    rejectReasonRows: rejectReasons,
    features,
    timeline: timeline.map((event, index) => ({
      stage: event.stage,
      stepOrder: index + 1,
      outcome: event.outcome,
      message: event.message ?? null,
      details: asJson(event.details),
    })),
  });
}

export function observeExecutionDecision(input: ExecutionDecisionObservabilityInput) {
  if (input.candidate) {
    mergeDecisionScores(extractScoresFromCandidate(input.candidate, input.ai));
    mergeDecisionFeatures(extractFeatureSnapshotFromCandidate(input.candidate, input.ai));
    if (input.candidate.context.metadata.marketRegimeStrategy) {
      setDecisionStrategyUsed(String(input.candidate.context.metadata.marketRegimeStrategy));
    }
    setDecisionMarketState(input.candidate.context.metadata as Record<string, unknown>);
  }
  if (input.qualityGate) {
    observeQualityGateDecision({
      decisionId: input.decisionId,
      symbol: input.symbol,
      qualityGate: input.qualityGate,
    });
  }
  if (input.rejectReason) {
    mergeDecisionRejectReasons([categorizeRejectReason(input.rejectReason, 0.95)]);
  }
  recordDecisionTimelineEvent({
    stage: "EVALUATION",
    outcome: input.opened ? "OPENED" : input.rejected ? "REJECT" : "COMPLETE",
    message: input.rejectReason ?? (input.opened ? "Trade opened" : "Execution completed"),
    details: input.metadata,
  });
  bridgeExecutionDecision({
    candidateId: createCandidateId(input.symbol, input.opened ? "execution" : "decision"),
    symbol: input.symbol,
    approved: input.opened,
    reasonCode: input.rejectReason ?? (input.opened ? "EXECUTION_OPENED" : "EXECUTION_REJECT"),
    reasonDetail: input.rejectReason ?? (input.opened ? "Trade opened" : "Execution rejected or skipped"),
    stage: input.opened ? "execution" : "decision",
    score: input.candidate?.score?.score,
  });

  safeObserve(
    finalizeDecisionLog({
      decisionId: input.decisionId,
      analysisId: input.decisionId,
      symbol: input.symbol,
      decision: input.decision ?? (input.opened ? "BUY" : input.rejected ? "NO_TRADE" : "HOLD"),
      executionAllowed: input.opened,
      rejectReasons: input.rejectReason ? [categorizeRejectReason(input.rejectReason, 0.95)] : undefined,
      strategyUsed: input.candidate?.context.metadata.marketRegimeStrategy
        ? String(input.candidate.context.metadata.marketRegimeStrategy)
        : undefined,
      metadata: input.metadata,
    }),
  );
}

export async function runWithExecutionDecisionTrace<T>(
  input: BeginDecisionTraceInput,
  fn: () => Promise<T>,
): Promise<T> {
  const trace = beginDecisionTrace({ ...input, deferPersistence: true });
  return runWithDecisionTrace(trace, fn);
}

export async function fetchDecisionLog(decisionId: string) {
  return getDecisionLogByDecisionId(decisionId);
}

export async function fetchDecisionLogs(input?: Parameters<typeof listDecisionLogs>[0]) {
  return listDecisionLogs(input);
}

export function observeDeferredExecutionResult(input: ExecutionDecisionObservabilityInput) {
  safeObserve(Promise.resolve().then(() => observeExecutionDecision(input)));
}
