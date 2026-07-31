import type { TradeLearningHorizon } from "@/src/server/trading-core/self-learning/self-learning-types";

type SetupFeatureSnapshot = {
  features: string[];
  numericFeatures: LearningNumericFeature[];
  patternKey: string;
  marketRegime?: string;
  marketRegimeStrategy?: string;
  horizon: TradeLearningHorizon;
  entryType?: string;
  confirmationStatus?: string;
  qualityDecision?: string;
  qualityTier?: string;
  qualityScore?: number;
  ruleTags: string[];
};

export type LearningNumericFeature = {
  key: string;
  value: number;
  category: string;
  weight?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function resolveQualityTier(score: number) {
  if (score >= 82) return "elite";
  if (score >= 74) return "strong";
  if (score >= 64) return "mid";
  return "low";
}

function safeNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function bucket(value: number | undefined, buckets: Array<[number, string]>, fallback = "unknown") {
  if (value === undefined) return fallback;
  for (const [limit, label] of buckets) {
    if (value <= limit) return label;
  }
  return buckets[buckets.length - 1]?.[1] ?? fallback;
}

function signedBucket(value: number | undefined, deadZone: number, strong: number) {
  if (value === undefined) return "unknown";
  if (Math.abs(value) < deadZone) return "flat";
  if (value >= strong) return "strong_positive";
  if (value > 0) return "positive";
  if (value <= -strong) return "strong_negative";
  return "negative";
}

function resolveHorizon(maxDurationSec: number | undefined): SetupFeatureSnapshot["horizon"] {
  if (maxDurationSec !== undefined && maxDurationSec > 0 && maxDurationSec <= 600) return "SCALP_5M";
  if (maxDurationSec !== undefined && maxDurationSec > 0 && maxDurationSec <= 900) return "INTRADAY_15M";
  if (maxDurationSec !== undefined && maxDurationSec > 0 && maxDurationSec <= 1800) return "SHORT_30M";
  if (maxDurationSec !== undefined && maxDurationSec > 0 && maxDurationSec <= 3600) return "INTRADAY_1H";
  if (maxDurationSec !== undefined && maxDurationSec > 0 && maxDurationSec <= 14400) return "INTRADAY_4H";
  return "SESSION";
}

export function buildSetupFeatureSnapshot(metadata: Record<string, unknown>): SetupFeatureSnapshot {
  const ruleTags = Array.isArray(metadata.ruleTags)
    ? metadata.ruleTags.map((x) => String(x)).filter(Boolean)
    : [];
  const marketRegime = metadata.marketRegime ? String(metadata.marketRegime) : undefined;
  const marketRegimeStrategy = metadata.marketRegimeStrategy ? String(metadata.marketRegimeStrategy) : undefined;
  const smartEntry = (metadata.smartEntry as Record<string, unknown> | undefined) ?? {};
  const entryTypeRaw = smartEntry.recommendedEntryType ? String(smartEntry.recommendedEntryType) : undefined;
  const confirmationStatusRaw = smartEntry.confirmationStatus ? String(smartEntry.confirmationStatus) : undefined;
  const qualityDecision = metadata.qualityDecision ? String(metadata.qualityDecision) : undefined;
  const qualityScoreRaw = Number(metadata.qualityScore ?? NaN);
  const qualityScore = Number.isFinite(qualityScoreRaw) ? clamp(qualityScoreRaw, 0, 100) : undefined;
  const marketRegimeConfidence = safeNumber(metadata.marketRegimeConfidenceScore ?? metadata.marketRegimeConfidence);
  const qualityTier = qualityScore !== undefined ? resolveQualityTier(qualityScore) : undefined;
  const maxDurationSec = safeNumber(metadata.maxDurationSec);
  const horizon = resolveHorizon(maxDurationSec);
  const mtfAlignment = safeNumber(metadata.mtfAlignmentScore ?? (metadata.timeframeAnalysis as Record<string, unknown> | undefined)?.alignmentScore);
  const shortMomentum = safeNumber(metadata.shortMomentumPercent);
  const shortFlow = safeNumber(metadata.shortFlowImbalance);
  const tradeVelocity = safeNumber(metadata.tradeVelocity);
  const spreadPercent = safeNumber(metadata.spreadPercent);
  const volatilityPercent = safeNumber(metadata.volatilityPercent);
  const orderBookImbalance = safeNumber(metadata.orderBookImbalance);
  const fakeSpikeScore = safeNumber(metadata.fakeSpikeScore ?? metadata.fakeBreakoutRiskScore);
  const pumpRisk = safeNumber(metadata.pumpRisk);
  const pumpIntensity = safeNumber(metadata.pumpIntensity);
  const pumpEarlyCatcher = metadata.pumpEarlyCatcher === true;
  const pumpEarlyPriorityScore = safeNumber(metadata.pumpEarlyPriorityScore);
  const pumpEarlyMaxMovePercent = safeNumber(metadata.pumpEarlyMaxMovePercent);
  const volumeSpikePercent = safeNumber(metadata.volumeSpikePercent);
  const momentumBreakout = (metadata.momentumBreakout as Record<string, unknown> | undefined) ?? {};
  const momentumBreakoutOk = momentumBreakout.ok === true;
  const momentumBreakoutScore = safeNumber(momentumBreakout.score);
  const momentumBreakoutStage = momentumBreakout.stage ? String(momentumBreakout.stage) : undefined;
  const momentumBreakoutDirection = momentumBreakout.direction ? String(momentumBreakout.direction) : undefined;
  const aiConfidence = safeNumber(metadata.aiConfidence ?? metadata.confidence);
  const aiRiskScore = safeNumber(metadata.aiRiskScore);
  const slippagePercent = safeNumber(metadata.slippagePercent ?? metadata.slippage);
  const executionQualityScore = safeNumber(metadata.executionQualityScore);
  const manipulationRiskScore = safeNumber(metadata.manipulationRiskScore);
  const futuresRiskScore = safeNumber(metadata.futuresRiskScore);
  const leverageStressScore = safeNumber(metadata.leverageStressScore);
  const squeezeProbability = safeNumber(metadata.squeezeProbability);
  const leveragedTrapProbability = safeNumber(metadata.leveragedTrapProbability);
  const oiPriceDivergenceScore = safeNumber(metadata.oiPriceDivergenceScore);
  const positioningPressure = safeNumber(metadata.positioningPressure);
  const fundingRate = safeNumber(metadata.fundingRate);
  const fundingDelta = safeNumber(metadata.fundingDelta);
  const openInterest = safeNumber(metadata.openInterest);
  const openInterestDelta = safeNumber(metadata.openInterestDelta);
  const longShortRatio = safeNumber(metadata.longShortRatio);
  const liquidationImbalance = safeNumber(metadata.liquidationImbalance);
  const regimeStabilityScore = safeNumber(metadata.regimeStabilityScore);
  const regimeAgeSec = safeNumber(metadata.regimeAgeSec);
  const regimeTransitionProbability = safeNumber(metadata.regimeTransitionProbability);
  const regimeFlipRisk = safeNumber(metadata.regimeFlipRisk);
  const regimeChaosProbability = safeNumber(metadata.regimeChaosProbability);
  const regimePersistenceScore = safeNumber(metadata.regimePersistenceScore);
  const regimeSwitchCount10m = safeNumber(metadata.regimeSwitchCount10m);
  const takeProfitPercent = safeNumber(metadata.takeProfitPercent ?? metadata.targetProfitPercent);
  const stopLossPercent = safeNumber(metadata.stopLossPercent);
  const rrRatio =
    takeProfitPercent !== undefined && stopLossPercent !== undefined && stopLossPercent > 0
      ? Number((takeProfitPercent / stopLossPercent).toFixed(4))
      : undefined;

  const features = [
    `horizon:${normalizeText(horizon)}`,
    marketRegime ? `regime:${normalizeText(marketRegime)}` : "",
    marketRegimeStrategy ? `strategy:${normalizeText(marketRegimeStrategy)}` : "",
    entryTypeRaw ? `entry:${normalizeText(entryTypeRaw)}` : "",
    confirmationStatusRaw ? `confirm:${normalizeText(confirmationStatusRaw)}` : "",
    qualityDecision ? `quality:${normalizeText(qualityDecision)}` : "",
    qualityTier ? `quality_tier:${normalizeText(qualityTier)}` : "",
    `mtf:${bucket(mtfAlignment, [[30, "weak"], [55, "mixed"], [72, "aligned"], [100, "strong_aligned"]])}`,
    `momentum:${signedBucket(shortMomentum, 0.04, 0.18)}`,
    `flow:${signedBucket(shortFlow, 0.015, 0.08)}`,
    `velocity:${bucket(tradeVelocity, [[0.005, "slow"], [0.025, "normal"], [0.08, "fast"], [999, "hyper"]])}`,
    `spread:${bucket(spreadPercent, [[0.08, "tight"], [0.18, "normal"], [0.35, "wide"], [999, "extreme"]])}`,
    `volatility:${bucket(volatilityPercent, [[0.8, "calm"], [2, "normal"], [4, "hot"], [999, "chaos"]])}`,
    `orderbook:${signedBucket(orderBookImbalance, 0.08, 0.35)}`,
    `fake_spike:${bucket(fakeSpikeScore, [[0.8, "low"], [1.8, "medium"], [2.8, "high"], [999, "extreme"]])}`,
    `pump_risk:${bucket(pumpRisk, [[25, "low"], [55, "medium"], [78, "high"], [100, "extreme"]])}`,
    `momentum_breakout:${momentumBreakoutOk ? "yes" : "no"}`,
    `pump_early:${pumpEarlyCatcher ? "yes" : "no"}`,
    momentumBreakoutStage ? `momentum_stage:${normalizeText(momentumBreakoutStage)}` : "",
    momentumBreakoutDirection ? `momentum_direction:${normalizeText(momentumBreakoutDirection)}` : "",
    `confidence:${bucket(aiConfidence, [[45, "low"], [65, "medium"], [82, "high"], [100, "elite"]])}`,
    `ai_risk:${bucket(aiRiskScore, [[35, "low"], [58, "medium"], [78, "high"], [100, "extreme"]])}`,
    metadata.futuresIntent ? `futures_intent:${normalizeText(String(metadata.futuresIntent))}` : "",
    `futures_risk:${bucket(futuresRiskScore, [[35, "low"], [58, "medium"], [78, "high"], [100, "extreme"]])}`,
    metadata.regimeLifecyclePhase ? `regime_lifecycle:${normalizeText(String(metadata.regimeLifecyclePhase))}` : "",
    Boolean(metadata.regimeChopWarning) ? "regime:chop_warning" : "",
    `regime_stability:${bucket(regimeStabilityScore, [[35, "fragile"], [58, "mixed"], [78, "stable"], [100, "persistent"]])}`,
    `rr:${bucket(rrRatio, [[1, "poor"], [1.8, "fair"], [2.8, "good"], [999, "excellent"]])}`,
    ...ruleTags.map((tag) => `rule:${normalizeText(String(tag))}`),
  ].filter(Boolean);
  const uniqueFeatures = Array.from(new Set(features));
  const numericFeatures = [
    ["mtfAlignment", mtfAlignment, "chart", 1.2],
    ["marketRegimeConfidence", marketRegimeConfidence, "regime", 1],
    ["shortMomentum", shortMomentum, "flow", 1.1],
    ["shortFlow", shortFlow, "flow", 1.1],
    ["tradeVelocity", tradeVelocity, "flow", 0.8],
    ["spreadPercent", spreadPercent, "market", 1],
    ["volatilityPercent", volatilityPercent, "market", 1],
    ["orderBookImbalance", orderBookImbalance, "orderbook", 1],
    ["fakeSpikeScore", fakeSpikeScore, "risk", 1.2],
    ["pumpRisk", pumpRisk, "risk", 1.1],
    ["pumpIntensity", pumpIntensity, "momentum", 0.8],
    ["pumpEarlyPriorityScore", pumpEarlyPriorityScore, "momentum", 1.4],
    ["pumpEarlyMaxMovePercent", pumpEarlyMaxMovePercent, "momentum", 1.2],
    ["pumpEarlyCatcher", pumpEarlyCatcher ? 1 : 0, "momentum", 1.4],
    ["volumeSpikePercent", volumeSpikePercent, "volume", 0.8],
    ["momentumBreakoutScore", momentumBreakoutScore, "momentum", 1.3],
    ["momentumBreakoutOk", momentumBreakoutOk ? 1 : 0, "momentum", 1.2],
    ["aiConfidence", aiConfidence, "ai", 1],
    ["aiRiskScore", aiRiskScore, "ai", 1],
    ["slippagePercent", slippagePercent, "execution", 1],
    ["executionQualityScore", executionQualityScore, "execution", 1],
    ["manipulationRiskScore", manipulationRiskScore, "risk", 1.2],
    ["futuresRiskScore", futuresRiskScore, "futures", 1.2],
    ["leverageStressScore", leverageStressScore, "futures", 1.1],
    ["squeezeProbability", squeezeProbability, "futures", 1.1],
    ["leveragedTrapProbability", leveragedTrapProbability, "futures", 1.2],
    ["oiPriceDivergenceScore", oiPriceDivergenceScore, "futures", 1],
    ["positioningPressure", positioningPressure, "futures", 0.9],
    ["fundingRate", fundingRate, "futures", 0.8],
    ["fundingDelta", fundingDelta, "futures", 0.8],
    ["openInterest", openInterest, "futures", 0.7],
    ["openInterestDelta", openInterestDelta, "futures", 0.9],
    ["longShortRatio", longShortRatio, "futures", 0.9],
    ["liquidationImbalance", liquidationImbalance, "futures", 1.1],
    ["regimeStabilityScore", regimeStabilityScore, "regime", 1.1],
    ["regimeAgeSec", regimeAgeSec, "regime", 0.7],
    ["regimeTransitionProbability", regimeTransitionProbability, "regime", 1.2],
    ["regimeFlipRisk", regimeFlipRisk, "regime", 1.2],
    ["regimeChaosProbability", regimeChaosProbability, "regime", 1.2],
    ["regimePersistenceScore", regimePersistenceScore, "regime", 1],
    ["regimeSwitchCount10m", regimeSwitchCount10m, "regime", 1],
    ["qualityScore", qualityScore, "quality", 1],
    ["takeProfitPercent", takeProfitPercent, "plan", 0.6],
    ["stopLossPercent", stopLossPercent, "plan", 0.6],
    ["rrRatio", rrRatio, "plan", 0.8],
    ["maxDurationSec", maxDurationSec, "plan", 0.5],
  ]
    .filter((row): row is [string, number, string, number] => row[1] !== undefined)
    .map(([key, value, category, weight]) => ({ key, value: Number(value.toFixed(6)), category, weight }));
  const keyFeatures = uniqueFeatures
    .filter((feature) => !feature.startsWith("rule:"))
    .slice(0, 18)
    .sort();
  return {
    features: uniqueFeatures,
    numericFeatures,
    patternKey: keyFeatures.join("|"),
    marketRegime,
    marketRegimeStrategy,
    horizon,
    entryType: entryTypeRaw,
    confirmationStatus: confirmationStatusRaw,
    qualityDecision,
    qualityTier,
    qualityScore,
    ruleTags,
  };
}
