import type { AIConsensusResult } from "@/src/types/ai";
import type {
  AdjudicateInput,
  ExpertOpinionResult,
  MasterDecisionOutput,
} from "@/src/server/decision-engine/decision-engine.types";
import { runAllExperts } from "@/src/server/decision-engine/experts/expert-runner.service";
import {
  buildAttribution,
  buildDecisionMatrix,
  buildHumanReadableDecision,
  computeConsensusMetrics,
  detectConflicts,
  mapMasterConsensusDecision,
  mapMasterToLegacy,
  resolveEffectiveTradingDecision,
  resolveMasterDecision,
  TRADING_DECISION_POLICY,
} from "@/src/server/decision-engine/conflict-detection.service";
import { persistMasterDecision } from "@/src/server/decision-engine/decision-engine.repository";
import { enqueueWatchlistIfNeeded } from "@/src/server/decision-engine/watchlist.service";
import { emitDecisionEngineEvent } from "@/src/server/decision-engine/decision-engine.events";
import { bridgeTdiDecision } from "@/src/server/forensics/forensic-bridge.service";
import { createCandidateId } from "@/src/server/forensics/forensic-collector.service";
import type { TdiFirstBlockingCondition } from "@/src/server/forensics/forensic.types";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
}

function mapExpertToBlockingCondition(expertType: ExpertOpinionResult["expertType"]): TdiFirstBlockingCondition {
  if (expertType === "MOMENTUM") return "MOMENTUM";
  if (expertType === "LEARNING") return "LEARNING";
  if (expertType === "RISK" || expertType === "LIQUIDITY") return "RISK";
  if (expertType === "MARKET") return "TECHNICAL";
  if (expertType === "EXECUTION") return "CONFIDENCE";
  return "OTHER";
}

export async function adjudicateWithMasterDecisionEngine(input: AdjudicateInput): Promise<AIConsensusResult> {
  const legacy = input.legacyResult;
  const expertOpinions = await runAllExperts(input.input, input.providerResults);
  const matrix = buildDecisionMatrix(expertOpinions);
  const conflicts = detectConflicts(expertOpinions);
  const metrics = computeConsensusMetrics(expertOpinions, conflicts);
  const attribution = buildAttribution(expertOpinions);
  const decision = resolveMasterDecision({ matrix, metrics, opinions: expertOpinions, conflicts });
  const effective = resolveEffectiveTradingDecision({
    masterDecision: decision,
    hybridDecision: legacy.finalDecision,
    hybridRejected: Boolean(legacy.rejected),
    hybridConfidence: Number(
      legacy.finalConsensusConfidence ?? legacy.finalConfidence ?? legacy.decisionPayload?.confidenceScore ?? 0,
    ),
    metrics,
    opinions: expertOpinions,
  });
  const legacyDecision = effective.legacyDecision;
  const hybridConfidence = Number(legacy.finalConfidence ?? 0);
  const blendedConfidence = round(
    clamp(hybridConfidence * 0.55 + metrics.confidence * 0.45 - metrics.conflictScore * 0.08, 0, 100),
    2,
  );
  const humanReadable = effective.preservedHybridBuy
    ? `${buildHumanReadableDecision({ decision, matrix, metrics, attribution })} | ${effective.preservationReason}`
    : buildHumanReadableDecision({ decision, matrix, metrics, attribution });

  const masterOutput: MasterDecisionOutput = {
    decisionId: input.decisionId,
    symbol: input.input.symbol,
    decision,
    legacyDecision,
    matrix,
    ...metrics,
    expertOpinions,
    conflicts,
    attribution,
    humanReadable,
    watchlist: decision === "WATCHLIST",
  };

  await persistMasterDecision(masterOutput).catch(() => null);
  if (masterOutput.watchlist) {
    await enqueueWatchlistIfNeeded(masterOutput).catch(() => null);
  }
  emitDecisionEngineEvent("decision.adjudicated", {
    decisionId: input.decisionId,
    symbol: input.input.symbol,
    decision,
    confidence: blendedConfidence,
  });

  const tdiVerdict =
    legacyDecision === "BUY" ? "APPROVED" : decision === "WAIT" || decision === "WATCHLIST" ? "WAIT" : "REJECTED";
  const roleScores = Array.isArray(legacy.roleScores) ? legacy.roleScores : [];
  const technicalRoleScore = roleScores.find((row) => row.role === "AI-1_TECHNICAL")?.score;
  const sentimentRoleScore = roleScores.find((row) => row.role === "AI-2_SENTIMENT")?.score;
  const shortMomentum = Number(input.input.marketSignals?.shortMomentumPercent ?? 0);
  const shortFlow = Number(input.input.marketSignals?.shortFlowImbalance ?? 0);
  const blockers = attribution.blockers.map((row) => mapExpertToBlockingCondition(row.expert)).filter((row, idx, arr) => arr.indexOf(row) === idx);
  const bullishCount = expertOpinions.filter((row) => row.opinion === "BUY" || row.opinion === "WEAK_BUY").length;
  const strategyRuntime = legacy.decisionPayload?.strategyRuntime;
  const strategyExecutionMode = String(
    (input.input.strategyParams as Record<string, unknown> | undefined)?.executionMode ??
      (input.input.strategyParams as Record<string, unknown> | undefined)?.mode ??
      "",
  ).toLowerCase();
  const paperRelaxed = strategyExecutionMode === "paper";
  bridgeTdiDecision({
    candidateId: createCandidateId(input.input.symbol, "tdi"),
    symbol: input.input.symbol,
    verdict: tdiVerdict,
    masterDecision: decision,
    legacyDecision: effective.legacyDecision,
    hybridDecision: legacy.finalDecision,
    hybridRejected: Boolean(legacy.rejected),
    consensusScore: metrics.consensusScore,
    technicalScore: technicalRoleScore != null ? round(technicalRoleScore, 2) : undefined,
    momentumScore: round(matrix.momentum, 2),
    sentimentScore: sentimentRoleScore != null ? round(sentimentRoleScore, 2) : undefined,
    shortMomentum: round(shortMomentum, 4),
    shortFlow: round(shortFlow, 4),
    executionScore: round(matrix.execution, 2),
    confidence: blendedConfidence,
    bullishCount,
    learningScore: round(matrix.learning, 2),
    liquidity: Number(input.input.volume24h ?? NaN),
    volatility: Number(input.input.volatility ?? NaN),
    expectedValue: round(metrics.consensusScore, 4),
    openInterest: Number(input.input.marketSignals?.openInterest ?? NaN),
    marketContext: String(input.input.marketRegime?.reason ?? ""),
    simulation: paperRelaxed ? "PAPER" : "LIVE",
    trendData: String(input.input.multiTimeframe?.dominantTrend ?? input.input.marketRegime?.mode ?? "UNKNOWN"),
    thresholds: {
      technicalMinScore: Number(strategyRuntime?.technicalMinScore ?? 0) || undefined,
      sentimentMinScore: Number(strategyRuntime?.sentimentMinScore ?? 0) || undefined,
      compositeMinScore: Number(strategyRuntime?.consensusMinScore ?? 0) || undefined,
      confidenceMinScore: TRADING_DECISION_POLICY.minMasterConfidenceToPreserve,
    },
    regime: String(input.input.marketRegime?.mode ?? "UNKNOWN"),
    regimeDelta: undefined,
    paperRelaxed,
    reasonCode: `MASTER_${decision}`,
    firstBlockingCondition: blockers[0],
    blockingConditions: blockers,
    strategy: String(input.input.marketRegime?.selectedStrategy ?? "UNKNOWN"),
    reasonDetail: humanReadable,
  });

  const mappedConsensusDecision = mapMasterConsensusDecision(decision, effective.preservedHybridBuy);

  return {
    ...legacy,
    finalDecision: legacyDecision,
    finalConsensusDecision: mappedConsensusDecision,
    finalConsensusConfidence: blendedConfidence,
    finalConfidence: blendedConfidence,
    finalRiskScore: Math.max(legacy.finalRiskScore, 100 - matrix.risk),
    score: metrics.consensusScore,
    explanation: humanReadable,
    rejected: legacyDecision === "NO_TRADE" && decision !== "WATCHLIST" && !effective.preservedHybridBuy,
    rejectReason:
      legacyDecision === "NO_TRADE" && !effective.preservedHybridBuy
        ? legacy.rejectReason ?? "Master decision engine: NO_TRADE"
        : undefined,
    decisionPayload: {
      ...(legacy.decisionPayload ?? {
        coin: input.input.symbol,
        entryPrice: input.input.lastPrice,
        targetPrice: null,
        stopPrice: null,
        riskRewardRatio: 0,
        technicalReason: "",
        sentimentReason: "",
        riskAssessment: "",
        confidenceScore: blendedConfidence,
        openTrade: legacyDecision === "BUY",
      }),
      confidenceScore: blendedConfidence,
      openTrade: legacyDecision === "BUY",
      masterDecisionEngine: {
        decision,
        effectiveLegacyDecision: legacyDecision,
        preservedHybridBuy: effective.preservedHybridBuy,
        tradingDecisionPolicy: TRADING_DECISION_POLICY,
        preservationReason: effective.preservationReason,
        blendedConfidence,
        hybridConfidence,
        matrix,
        consensusScore: metrics.consensusScore,
        conflictScore: metrics.conflictScore,
        agreementScore: metrics.agreementScore,
        stability: metrics.stability,
        reliability: metrics.reliability,
        conflicts,
        attribution,
        expertOpinions,
        humanReadable,
      },
    } as AIConsensusResult["decisionPayload"],
    generatedAt: new Date().toISOString(),
  };
}
