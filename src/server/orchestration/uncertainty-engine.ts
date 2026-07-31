import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import type { OrchestrationReasonMap, OrchestrationUncertaintyInput } from "@/src/server/orchestration/orchestration-types";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pushReason(map: OrchestrationReasonMap, key: string, reason: string) {
  map[key] = [...(map[key] ?? []), reason];
}

function decisionDisagreement(ai?: AIConsensusResult) {
  const decisions = (ai?.roleScores ?? []).map((row) => row.decision).filter(Boolean);
  if (decisions.length <= 1) return 0;
  const unique = new Set(decisions);
  return clamp((unique.size - 1) * 38 + (ai?.rejected ? 12 : 0));
}

export function evaluateUncertainty(input: {
  candidate: ScannerCandidate;
  ai?: AIConsensusResult;
  executionId?: string;
  tradeId?: string;
  positionId?: string;
}): OrchestrationUncertaintyInput {
  const { candidate, ai } = input;
  const meta = candidate.context.metadata ?? {};
  const reasonMap: OrchestrationReasonMap = {};
  const regimeTransition = num(meta.regimeTransitionProbability);
  const regimeFlip = num(meta.regimeFlipRisk);
  const regimeChaos = num(meta.regimeChaosProbability);
  const futuresRisk = num(meta.futuresRiskScore);
  const leveragedTrap = num(meta.leveragedTrapProbability);
  const manipulationPressure = num(meta.manipulationPressureScore);
  const mtfAlignment = num(ai?.decisionPayload?.timeframeAnalysis?.alignmentScore ?? meta.mtfAlignmentScore, 50);
  const scannerConfidence = num(candidate.score.confidence, 50);
  const aiConfidence = num(ai?.finalConfidence, scannerConfidence);
  const conflictingSignalScore = decisionDisagreement(ai);
  const dataConfidenceScore = clamp(
    100 -
      (candidate.context.tradable ? 0 : 25) -
      candidate.context.rejectReasons.length * 8 -
      num(meta.futuresIntelDegraded ? 18 : 0) -
      (num(meta.liveDataHealthy, 1) ? 0 : 22),
  );
  const decisionAmbiguity = clamp(
    conflictingSignalScore * 0.45 +
      (ai?.finalDecision === "HOLD" || ai?.finalDecision === "NO_TRADE" ? 18 : 0) +
      (Math.abs(aiConfidence - scannerConfidence) > 18 ? 12 : 0),
  );
  const manipulationSuspicion = clamp(
    candidate.context.fakeSpikeScore * 18 +
      candidate.context.pumpRisk * 0.45 +
      futuresRisk * 0.18 +
      leveragedTrap * 0.2 +
      manipulationPressure * 0.24,
  );
  const regimeInstability = clamp(regimeTransition * 0.42 + regimeFlip * 0.26 + regimeChaos * 0.32);
  const predictionStability = clamp(
    100 -
      regimeInstability * 0.38 -
      conflictingSignalScore * 0.28 -
      (100 - mtfAlignment) * 0.22 -
      manipulationSuspicion * 0.12,
  );
  const confidenceReliability = clamp(
    aiConfidence * 0.45 +
      scannerConfidence * 0.25 +
      dataConfidenceScore * 0.2 +
      predictionStability * 0.1 -
      manipulationSuspicion * 0.12,
  );
  const uncertaintyScore = clamp(
    regimeInstability * 0.26 +
      conflictingSignalScore * 0.18 +
      (100 - dataConfidenceScore) * 0.16 +
      (100 - predictionStability) * 0.18 +
      decisionAmbiguity * 0.12 +
      manipulationSuspicion * 0.1,
  );

  if (regimeTransition >= 62) pushReason(reasonMap, "regime", `Regime transition elevated (${regimeTransition.toFixed(1)})`);
  if (regimeFlip >= 68) pushReason(reasonMap, "regime", `Regime flip risk elevated (${regimeFlip.toFixed(1)})`);
  if (conflictingSignalScore >= 35) pushReason(reasonMap, "ai", "AI role decisions are conflicting");
  if (dataConfidenceScore <= 55) pushReason(reasonMap, "data", "Market data confidence is degraded");
  if (mtfAlignment <= 52) pushReason(reasonMap, "mtf", `MTF alignment weak (${mtfAlignment.toFixed(1)})`);
  if (manipulationSuspicion >= 58) pushReason(reasonMap, "manipulation", "Manipulation/futures trap suspicion is elevated");

  return {
    executionId: input.executionId,
    tradeId: input.tradeId,
    positionId: input.positionId,
    symbol: candidate.context.symbol,
    marketRegime: String(meta.marketRegime ?? "UNKNOWN"),
    uncertaintyScore: Number(uncertaintyScore.toFixed(2)),
    confidenceReliability: Number(confidenceReliability.toFixed(2)),
    predictionStability: Number(predictionStability.toFixed(2)),
    decisionAmbiguity: Number(decisionAmbiguity.toFixed(2)),
    conflictingSignalScore: Number(conflictingSignalScore.toFixed(2)),
    dataConfidenceScore: Number(dataConfidenceScore.toFixed(2)),
    manipulationSuspicion: Number(manipulationSuspicion.toFixed(2)),
    reasonMap,
    metadata: {
      regimeInstability: Number(regimeInstability.toFixed(2)),
      regimeTransition,
      regimeFlip,
      regimeChaos,
      futuresRisk,
      leveragedTrap,
      mtfAlignment,
      aiConfidence,
      scannerConfidence,
    },
  };
}
