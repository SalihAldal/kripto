import { env } from "@/lib/config";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";

export type SignalQualityResult = {
  ok: boolean;
  qualityScore: number;
  minimumRequiredScore: number;
  criteriaScores: SignalQualityScoreBreakdown;
  scoreBreakdown: SignalQualityScoreBreakdown;
  weightedTotal: number;
  confidenceTier: "HIGH_CONFIDENCE" | "CAUTION" | "REJECT";
  decision: "APPROVE" | "CAUTION" | "REJECT";
  whyAccepted: string[];
  whyRejected: string[];
  weights: {
    marketRegimeAlignment: number;
    higherTimeframeTrendAlignment: number;
    technicalSetupQuality: number;
    entryTimingQuality: number;
    volumeConfirmation: number;
    momentumQuality: number;
    liquiditySafety: number;
    newsSentimentAlignment: number;
    volatilitySuitability: number;
    riskRewardQuality: number;
  };
  reasons: string[];
  strengths: string[];
};

export type SignalQualityScoreBreakdown = {
  marketRegimeAlignment: number;
  higherTimeframeTrendAlignment: number;
  technicalSetupQuality: number;
  entryTimingQuality: number;
  volumeConfirmation: number;
  momentumQuality: number;
  liquiditySafety: number;
  newsSentimentAlignment: number;
  volatilitySuitability: number;
  riskRewardQuality: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function evaluateSignalQualityGate(input: {
  candidate: ScannerCandidate;
  ai: AIConsensusResult;
}): SignalQualityResult {
  const { candidate, ai } = input;
  const reasons: string[] = [];
  const strengths: string[] = [];
  const volume = candidate.context.volume24h;
  const spread = candidate.context.spreadPercent;
  const volatility = candidate.context.volatilityPercent;
  const fakeSpike = candidate.context.fakeSpikeScore;
  const shortMomentum = Number(candidate.context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(candidate.context.metadata.shortFlowImbalance ?? 0);
  const velocity = Number(candidate.context.metadata.tradeVelocity ?? 0);
  const technicalScore = Number(ai.roleScores?.find((x) => x.role === "AI-1_TECHNICAL")?.score ?? 50);
  const sentimentScore = Number(ai.roleScores?.find((x) => x.role === "AI-2_SENTIMENT")?.score ?? 50);
  const riskScore = Number(ai.finalRiskScore ?? 100);
  const scannerScore = Number(candidate.score.score ?? 50);
  const marketRegime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const marketRegimeReason = String(candidate.context.metadata.marketRegimeReason ?? "");
  const liquidityRejectReason = String(ai.decisionPayload?.entryRejectReason ?? "");
  const liquidityIntel = ai.decisionPayload?.liquidityIntel;
  const liquidityZones = Array.isArray(ai.decisionPayload?.liquidityZones)
    ? ai.decisionPayload?.liquidityZones
    : [];
  const timeframeAnalysis = ai.decisionPayload?.timeframeAnalysis;
  const strategyRuntime = (ai.decisionPayload as Record<string, unknown> | undefined)?.strategyRuntime as
    | Record<string, unknown>
    | undefined;
  const baseMinRequiredScore = Number(
    strategyRuntime?.consensusMinScore ?? env.EXECUTION_MIN_TRADE_QUALITY_SCORE ?? 60,
  );
  const canApplyAdaptiveRelaxation =
    (timeframeAnalysis?.alignmentScore ?? 0) >= 70 &&
    riskScore <= 42 &&
    spread <= 0.12 &&
    volatility <= 2.5;
  const adaptiveReduction =
    canApplyAdaptiveRelaxation &&
    (marketRegime === "RANGE_SIDEWAYS" || marketRegime === "WEAK_BULLISH_TREND" || marketRegime === "WEAK_BEARISH_TREND")
      ? 8
      : 0;
  const minRequiredScore = clamp(baseMinRequiredScore - adaptiveReduction, 48, baseMinRequiredScore);
  const rr = Number(ai.decisionPayload?.riskRewardRatio ?? 0);
  const hardRejectReasons: string[] = [];
  const trendAlignmentRaw = clamp(
    (timeframeAnalysis?.trendAligned ? 58 : 24) +
      (timeframeAnalysis?.entrySuitable ? 22 : 8) +
      (timeframeAnalysis?.conflict ? -38 : 10),
    0,
    100,
  );
  const volumeRatio = volume / Math.max(env.SCANNER_MIN_VOLUME_24H, 1);
  const volumeSupport = clamp(34 + volumeRatio * 36 + clamp(velocity, 0, 1.5) * 10, 0, 100);
  const indicatorAlignment = clamp(technicalScore * 0.72 + scannerScore * 0.28, 0, 100);
  const rrScore = rr <= 0 ? 0 : clamp((rr / Math.max(env.AI_HYBRID_MIN_RR_RATIO, 0.01)) * 100, 0, 100);
  const riskReward = clamp(rrScore * 0.6 + (100 - riskScore) * 0.4, 0, 100);
  const spreadFit = clamp((1 - spread / Math.max(env.AI_HYBRID_MAX_SPREAD_PERCENT, 0.0001)) * 100, 0, 100);
  const volFit = clamp((1 - volatility / Math.max(env.AI_HYBRID_MAX_VOLATILITY_PERCENT, 0.0001)) * 100, 0, 100);
  const volatilityFit = clamp(spreadFit * 0.55 + volFit * 0.45, 0, 100);
  const liquidityBase = clamp(volumeSupport * 0.5 + spreadFit * 0.3 + (100 - clamp(fakeSpike * 25, 0, 100)) * 0.2, 0, 100);
  const liquidityState = clamp(
    liquidityBase -
      (liquidityRejectReason ? 35 : 0) +
      (liquidityZones.length >= 2 ? 5 : 0) -
      Number((liquidityIntel?.liquidityRiskScore ?? 0) * 0.22),
    0,
    100,
  );
  const newsImpact = clamp(sentimentScore, 0, 100);

  const marketRegimeAlignment = clamp(
    (marketRegime === "STRONG_BULLISH_TREND" || marketRegime === "WEAK_BULLISH_TREND" ? 80 : 0) +
      (marketRegime === "RANGE_SIDEWAYS" ? 64 : 0) +
      (marketRegime === "WEAK_BEARISH_TREND" ? 48 : 0) +
      (marketRegime === "STRONG_BEARISH_TREND" ? 40 : 0) +
      (marketRegime === "HIGH_VOLATILITY_CHAOS" ? 22 : 0) +
      (marketRegime === "LOW_VOLUME_DEAD_MARKET" ? 10 : 0) +
      (marketRegime === "NEWS_DRIVEN_UNSTABLE" ? 18 : 0) +
      (ai.finalDecision === "BUY" && (marketRegime === "STRONG_BULLISH_TREND" || marketRegime === "WEAK_BULLISH_TREND") ? 12 : 0) +
      (ai.finalDecision === "SELL" && (marketRegime === "STRONG_BEARISH_TREND" || marketRegime === "WEAK_BEARISH_TREND") ? 12 : 0),
    0,
    100,
  );
  const higherTimeframeTrendAlignment = clamp(
    trendAlignmentRaw * 0.45 +
      clamp(timeframeAnalysis?.alignmentScore ?? 50, 0, 100) * 0.4 +
      (timeframeAnalysis?.higher?.confidence ?? 50) * 0.15,
    0,
    100,
  );
  const technicalSetupQuality = clamp(indicatorAlignment, 0, 100);
  const entryTimingQuality = clamp(
    (timeframeAnalysis?.entrySuitable ? 58 : 28) +
      (liquidityIntel?.safeEntryTiming?.toLowerCase().includes("after") ? 10 : 0) +
      (timeframeAnalysis?.lower?.entryQuality === "HIGH" ? 18 : timeframeAnalysis?.lower?.entryQuality === "MEDIUM" ? 8 : -8) +
      (timeframeAnalysis?.conflict ? -20 : 10),
    0,
    100,
  );
  const volumeConfirmation = clamp(volumeSupport, 0, 100);
  const unbackedSpike = Math.abs(shortMomentum) > 1.1 && Math.abs(shortFlow) < 0.035 && sentimentScore < 54;
  const momentumQuality = clamp(
    45 +
      clamp(Math.abs(shortMomentum) * 28, 0, 25) +
      clamp(Math.abs(shortFlow) * 520, 0, 18) +
      clamp(velocity * 10, 0, 12) -
      (unbackedSpike ? 26 : 0),
    0,
    100,
  );
  const liquiditySafety = clamp(liquidityState, 0, 100);
  const newsSentimentAlignment = clamp(newsImpact, 0, 100);
  const volatilitySuitability = clamp(volatilityFit, 0, 100);
  const riskRewardQuality = clamp(riskReward, 0, 100);

  const scoreBreakdown: SignalQualityScoreBreakdown = {
    marketRegimeAlignment: Number(marketRegimeAlignment.toFixed(2)),
    higherTimeframeTrendAlignment: Number(higherTimeframeTrendAlignment.toFixed(2)),
    technicalSetupQuality: Number(technicalSetupQuality.toFixed(2)),
    entryTimingQuality: Number(entryTimingQuality.toFixed(2)),
    volumeConfirmation: Number(volumeConfirmation.toFixed(2)),
    momentumQuality: Number(momentumQuality.toFixed(2)),
    liquiditySafety: Number(liquiditySafety.toFixed(2)),
    newsSentimentAlignment: Number(newsSentimentAlignment.toFixed(2)),
    volatilitySuitability: Number(volatilitySuitability.toFixed(2)),
    riskRewardQuality: Number(riskRewardQuality.toFixed(2)),
  };
  const weights = {
    marketRegimeAlignment: 0.1,
    higherTimeframeTrendAlignment: 0.12,
    technicalSetupQuality: 0.13,
    entryTimingQuality: 0.1,
    volumeConfirmation: 0.1,
    momentumQuality: 0.1,
    liquiditySafety: 0.1,
    newsSentimentAlignment: 0.08,
    volatilitySuitability: 0.08,
    riskRewardQuality: 0.09,
  } as const;

  if (!timeframeAnalysis?.trendAligned || !timeframeAnalysis?.entrySuitable || timeframeAnalysis?.conflict) {
    reasons.push(`MTF uyumsuz: ${timeframeAnalysis?.reason ?? "timeframe conflict"}`);
    hardRejectReasons.push("Trend + entry uyumu yok");
  } else {
    strengths.push("Trend uyumu guclu");
  }
  if (volumeSupport < 45) reasons.push("Hacim destegi zayif");
  else strengths.push("Hacim destegi yeterli");
  if (indicatorAlignment < 50) reasons.push("Indikator uyumu zayif");
  else strengths.push("Indikator uyumu iyi");
  if (riskReward < 50) reasons.push("Risk/odul setup zayif");
  else strengths.push("Risk/odul dengesi iyi");
  if (volatilityFit < 45) reasons.push("Volatilite/spread uygun degil");
  else strengths.push("Volatilite uygun");
  if (liquidityState < 45) reasons.push("Likidite kalitesi dusuk");
  else strengths.push("Likidite durumu uygun");
  if (newsImpact < 45) reasons.push("Haber/sentiment etkisi negatif");
  else strengths.push("Haber/sentiment pozitif");

  if (unbackedSpike) {
    reasons.push("Habersiz ani spike supheli");
    hardRejectReasons.push("Habersiz spike");
  }
  if (marketRegime === "LOW_VOLUME_DEAD_MARKET") {
    reasons.push("Low volume modu: islem pas gecildi");
    hardRejectReasons.push("Low volume regime");
  }
  if (liquidityRejectReason) {
    reasons.push(`Likidite filtresi: ${liquidityRejectReason}`);
    hardRejectReasons.push("Likidite reject");
  }
  if (Number(liquidityIntel?.fakeBreakoutRisk ?? 0) >= 62) {
    reasons.push("Fake breakout riski yuksek");
    hardRejectReasons.push("Fake breakout risk");
  }
  if (riskScore > env.AI_MAX_RISK_SCORE) {
    reasons.push("Risk skoru yuksek");
    hardRejectReasons.push("Risk skoru asiri yuksek");
  }

  const weightedTotal = Number(
    clamp(
      scoreBreakdown.marketRegimeAlignment * weights.marketRegimeAlignment +
        scoreBreakdown.higherTimeframeTrendAlignment * weights.higherTimeframeTrendAlignment +
        scoreBreakdown.technicalSetupQuality * weights.technicalSetupQuality +
        scoreBreakdown.entryTimingQuality * weights.entryTimingQuality +
        scoreBreakdown.volumeConfirmation * weights.volumeConfirmation +
        scoreBreakdown.momentumQuality * weights.momentumQuality +
        scoreBreakdown.liquiditySafety * weights.liquiditySafety +
        scoreBreakdown.newsSentimentAlignment * weights.newsSentimentAlignment +
        scoreBreakdown.volatilitySuitability * weights.volatilitySuitability +
        scoreBreakdown.riskRewardQuality * weights.riskRewardQuality,
      0,
      100,
    ).toFixed(2),
  );
  const highConfidenceThreshold = Math.max(minRequiredScore + 16, 82);
  const decision: SignalQualityResult["decision"] =
    hardRejectReasons.length > 0 || weightedTotal < minRequiredScore
      ? "REJECT"
      : weightedTotal >= highConfidenceThreshold
        ? "APPROVE"
        : "CAUTION";
  const confidenceTier: SignalQualityResult["confidenceTier"] =
    decision === "APPROVE" ? "HIGH_CONFIDENCE" : decision === "CAUTION" ? "CAUTION" : "REJECT";
  const whyAccepted = decision === "REJECT" ? [] : [...new Set(strengths)];
  const whyRejected = decision === "REJECT" ? [...new Set([...hardRejectReasons, ...reasons])] : [];

  return {
    ok: decision !== "REJECT",
    qualityScore: weightedTotal,
    minimumRequiredScore: minRequiredScore,
    criteriaScores: scoreBreakdown,
    scoreBreakdown,
    weightedTotal,
    confidenceTier,
    decision,
    whyAccepted,
    whyRejected,
    weights,
    reasons: marketRegimeReason ? [...reasons, `Regime reason: ${marketRegimeReason}`] : reasons,
    strengths,
  };
}
