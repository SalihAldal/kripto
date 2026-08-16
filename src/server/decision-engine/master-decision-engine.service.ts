import type { AIConsensusResult } from "@/src/types/ai";
import type { AdjudicateInput, MasterDecisionOutput } from "@/src/server/decision-engine/decision-engine.types";
import { runAllExperts } from "@/src/server/decision-engine/experts/expert-runner.service";
import {
  buildAttribution,
  buildDecisionMatrix,
  buildHumanReadableDecision,
  computeConsensusMetrics,
  detectConflicts,
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals = 2) {
  return Number(value.toFixed(decimals));
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
  bridgeTdiDecision({
    candidateId: createCandidateId(input.input.symbol, "tdi"),
    symbol: input.input.symbol,
    verdict: tdiVerdict,
    masterDecision: decision,
    legacyDecision: effective.legacyDecision,
    hybridDecision: legacy.finalDecision,
    hybridRejected: Boolean(legacy.rejected),
    consensusScore: metrics.consensusScore,
    confidence: blendedConfidence,
    strategy: String(input.input.marketRegime?.selectedStrategy ?? "UNKNOWN"),
    reasonDetail: humanReadable,
  });

  const mappedConsensusDecision =
    decision === "STRONG_BUY" || decision === "BUY"
      ? "BUY"
      : decision === "WATCHLIST"
        ? "WATCHLIST"
        : decision === "SELL" || decision === "REDUCE"
          ? "REJECT"
          : "NO-TRADE";

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
