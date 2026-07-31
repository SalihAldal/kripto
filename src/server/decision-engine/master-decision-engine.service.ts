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
  resolveMasterDecision,
} from "@/src/server/decision-engine/conflict-detection.service";
import { persistMasterDecision } from "@/src/server/decision-engine/decision-engine.repository";
import { enqueueWatchlistIfNeeded } from "@/src/server/decision-engine/watchlist.service";
import { emitDecisionEngineEvent } from "@/src/server/decision-engine/decision-engine.events";

export async function adjudicateWithMasterDecisionEngine(input: AdjudicateInput): Promise<AIConsensusResult> {
  const expertOpinions = await runAllExperts(input.input, input.providerResults);
  const matrix = buildDecisionMatrix(expertOpinions);
  const conflicts = detectConflicts(expertOpinions);
  const metrics = computeConsensusMetrics(expertOpinions, conflicts);
  const attribution = buildAttribution(expertOpinions);
  const decision = resolveMasterDecision({ matrix, metrics, opinions: expertOpinions, conflicts });
  const legacyDecision = mapMasterToLegacy(decision);
  const humanReadable = buildHumanReadableDecision({ decision, matrix, metrics, attribution });

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
    confidence: metrics.confidence,
  });

  const legacy = input.legacyResult;
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
    finalConsensusConfidence: metrics.confidence,
    finalConfidence: metrics.confidence,
    finalRiskScore: Math.max(legacy.finalRiskScore, 100 - matrix.risk),
    score: metrics.consensusScore,
    explanation: humanReadable,
    rejected: legacyDecision === "NO_TRADE" && decision !== "WATCHLIST",
    rejectReason: legacyDecision === "NO_TRADE" ? legacy.rejectReason ?? "Master decision engine: NO_TRADE" : undefined,
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
        confidenceScore: metrics.confidence,
        openTrade: legacyDecision === "BUY",
      }),
      confidenceScore: metrics.confidence,
      openTrade: legacyDecision === "BUY",
      masterDecisionEngine: {
        decision,
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
