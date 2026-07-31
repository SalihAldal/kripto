import type { LearningNumericFeature } from "@/src/server/metrics/setup-feature-utils";
import type { DeepPostTradeAnalysis, PostTradeCritic } from "@/src/server/trading-core/self-learning/self-learning-types";

export type LearningWeightFactor = {
  key: string;
  value: number | string | boolean | undefined;
  multiplier: number;
  reason: string;
};

export type DynamicLearningWeight = {
  weight: number;
  rawWeight: number;
  normalizedWeight: number;
  regimeNormalizer: number;
  confidence: number;
  label: "NOISE" | "WEAK" | "NORMAL" | "STRONG" | "ELITE";
  factors: LearningWeightFactor[];
  summary: string;
  generatedAt: string;
};

export type DynamicLearningWeightInput = {
  marketRegime?: string;
  regimeConfidence?: number;
  volatilityPercent?: number;
  manipulationProbability?: number;
  fakeSpikeScore?: number;
  pumpRisk?: number;
  spreadPercent?: number;
  liquidityDepth?: number;
  mtfAlignment?: number;
  signalCleanliness?: number;
  setupQuality?: number;
  slippageSeverity?: number;
  executionQuality?: number;
  orderbookStability?: number;
  aiConfidence?: number;
  criticConfidence?: number;
  anomalyScore?: number;
  qualityScore?: number;
  deepAnalysis?: DeepPostTradeAnalysis;
  critic?: PostTradeCritic;
  numericFeatures?: LearningNumericFeature[];
  metadata?: Record<string, unknown>;
};

function optionalNumber(...values: unknown[]) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function featureValue(features: LearningNumericFeature[] | undefined, key: string) {
  return features?.find((feature) => feature.key === key)?.value;
}

function metadataNumber(metadata: Record<string, unknown> | undefined, ...keys: string[]) {
  if (!metadata) return undefined;
  for (const key of keys) {
    const value = optionalNumber(metadata[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function percentQuality(value: number | undefined, goodAt: number, badAt: number, inverse = false) {
  if (value === undefined) return 50;
  const normalized = inverse
    ? ((badAt - value) / Math.max(badAt - goodAt, 0.0001)) * 100
    : ((value - badAt) / Math.max(goodAt - badAt, 0.0001)) * 100;
  return clamp(normalized, 0, 100);
}

function resolveRegimeBase(regime?: string) {
  const normalized = String(regime ?? "UNKNOWN").toUpperCase();
  if (normalized.includes("MANIPULATION")) return 0.18;
  if (normalized.includes("HIGH_VOLATILITY_CHAOS") || normalized.includes("NEWS_DRIVEN_UNSTABLE")) return 0.38;
  if (normalized.includes("LOW_VOLUME_DEAD_MARKET")) return 0.22;
  if (normalized.includes("LOW_VOLATILITY") || normalized.includes("SIDEWAYS") || normalized.includes("RANGE")) return 0.72;
  if (normalized.includes("ROCKET_PUMP")) return 0.82;
  if (normalized.includes("STRONG_BULLISH") || normalized.includes("TRENDING_BULLISH")) return 1.22;
  if (normalized.includes("WEAK_BULLISH") || normalized.includes("WEAK_BEARISH")) return 0.9;
  if (normalized.includes("STRONG_BEARISH") || normalized.includes("TRENDING_BEARISH")) return 0.74;
  return 1;
}

function resolveRegimeNormalizer(regime?: string) {
  const normalized = String(regime ?? "UNKNOWN").toUpperCase();
  if (normalized.includes("MANIPULATION")) return 0.45;
  if (normalized.includes("HIGH_VOLATILITY_CHAOS") || normalized.includes("NEWS_DRIVEN_UNSTABLE")) return 0.62;
  if (normalized.includes("LOW_VOLUME_DEAD_MARKET")) return 0.5;
  if (normalized.includes("LOW_VOLATILITY") || normalized.includes("SIDEWAYS") || normalized.includes("RANGE")) return 0.82;
  if (normalized.includes("ROCKET_PUMP")) return 0.92;
  if (normalized.includes("STRONG_BULLISH") || normalized.includes("TRENDING_BULLISH")) return 1.08;
  if (normalized.includes("STRONG_BEARISH") || normalized.includes("TRENDING_BEARISH")) return 0.88;
  return 1;
}

function factor(key: string, value: number | string | boolean | undefined, multiplier: number, reason: string): LearningWeightFactor {
  return { key, value, multiplier: round(clamp(multiplier, 0.05, 2.4)), reason };
}

function labelFor(weight: number): DynamicLearningWeight["label"] {
  if (weight < 0.35) return "NOISE";
  if (weight < 0.75) return "WEAK";
  if (weight < 1.18) return "NORMAL";
  if (weight < 1.55) return "STRONG";
  return "ELITE";
}

export function buildDynamicLearningWeight(input: DynamicLearningWeightInput): DynamicLearningWeight {
  const metadata = input.metadata;
  const numericFeatures = input.numericFeatures;
  const marketRegime = input.marketRegime ?? String(metadata?.marketRegime ?? "");
  const regimeConfidence = optionalNumber(
    input.regimeConfidence,
    featureValue(numericFeatures, "marketRegimeConfidence"),
    metadataNumber(metadata, "marketRegimeConfidenceScore", "marketRegimeConfidence"),
  );
  const volatilityPercent = optionalNumber(input.volatilityPercent, featureValue(numericFeatures, "volatilityPercent"), metadataNumber(metadata, "volatilityPercent"));
  const fakeSpikeScore = optionalNumber(input.fakeSpikeScore, featureValue(numericFeatures, "fakeSpikeScore"), metadataNumber(metadata, "fakeSpikeScore", "fakeBreakoutRiskScore"));
  const pumpRisk = optionalNumber(input.pumpRisk, featureValue(numericFeatures, "pumpRisk"), metadataNumber(metadata, "pumpRisk"));
  const spreadPercent = optionalNumber(input.spreadPercent, featureValue(numericFeatures, "spreadPercent"), metadataNumber(metadata, "spreadPercent"));
  const mtfAlignment = optionalNumber(input.mtfAlignment, featureValue(numericFeatures, "mtfAlignment"), metadataNumber(metadata, "mtfAlignmentScore"));
  const qualityScore = optionalNumber(input.setupQuality, input.qualityScore, featureValue(numericFeatures, "qualityScore"), metadataNumber(metadata, "qualityScore"));
  const aiConfidence = optionalNumber(input.aiConfidence, featureValue(numericFeatures, "aiConfidence"), metadataNumber(metadata, "aiConfidence", "confidence"));
  const slippageSeverity = optionalNumber(input.slippageSeverity, metadataNumber(metadata, "slippagePercent", "slippage"));
  const orderBookImbalance = optionalNumber(featureValue(numericFeatures, "orderBookImbalance"), metadataNumber(metadata, "orderBookImbalance"));
  const orderbookStability = input.orderbookStability ?? percentQuality(Math.abs(orderBookImbalance ?? 0), 0.08, 0.45, true);
  const liquidityDepth = optionalNumber(input.liquidityDepth, metadataNumber(metadata, "effectiveLiquidity24h", "volume24h"), input.deepAnalysis ? undefined : 0);
  const manipulationProbability = optionalNumber(input.manipulationProbability, input.anomalyScore, metadataNumber(metadata, "manipulationRiskScore"));
  const futuresRiskScore = optionalNumber(featureValue(numericFeatures, "futuresRiskScore"), metadataNumber(metadata, "futuresRiskScore"));
  const leveragedTrapProbability = optionalNumber(featureValue(numericFeatures, "leveragedTrapProbability"), metadataNumber(metadata, "leveragedTrapProbability"));
  const squeezeProbability = optionalNumber(featureValue(numericFeatures, "squeezeProbability"), metadataNumber(metadata, "squeezeProbability"));
  const regimeStabilityScore = optionalNumber(featureValue(numericFeatures, "regimeStabilityScore"), metadataNumber(metadata, "regimeStabilityScore"));
  const regimeTransitionProbability = optionalNumber(featureValue(numericFeatures, "regimeTransitionProbability"), metadataNumber(metadata, "regimeTransitionProbability"));
  const regimeFlipRisk = optionalNumber(featureValue(numericFeatures, "regimeFlipRisk"), metadataNumber(metadata, "regimeFlipRisk"));
  const regimeChaosProbability = optionalNumber(featureValue(numericFeatures, "regimeChaosProbability"), metadataNumber(metadata, "regimeChaosProbability"));
  const regimeChopWarning = Boolean(metadata?.regimeChopWarning ?? false);
  const criticConfidence = optionalNumber(input.criticConfidence, input.deepAnalysis?.confidence);
  const tradeQuality = input.deepAnalysis?.tradeQuality;
  const policyRecommendation = input.deepAnalysis?.policyRecommendation;
  const regimeCompatibility = input.deepAnalysis?.regimeCompatibility;
  const criticVerdict = input.critic?.verdict;

  const factors = [
    factor("marketRegime", marketRegime, resolveRegimeBase(marketRegime), `Regime base impact for ${marketRegime || "UNKNOWN"}`),
    factor("regimeConfidence", regimeConfidence, 0.78 + percentQuality(regimeConfidence, 90, 45) / 250, "Higher regime confidence makes the sample cleaner"),
    factor("volatilityState", volatilityPercent, volatilityPercent === undefined ? 1 : volatilityPercent >= 4 ? 0.58 : volatilityPercent >= 2.4 ? 0.78 : volatilityPercent <= 0.25 ? 0.74 : 1.08, "Extreme or dead volatility gets lower learning impact"),
    factor("manipulationProbability", manipulationProbability, manipulationProbability === undefined ? 1 : manipulationProbability >= 75 ? 0.38 : manipulationProbability >= 55 ? 0.62 : 1.03, "Manipulation probability protects memory from noisy trades"),
    factor("futuresRiskScore", futuresRiskScore, futuresRiskScore === undefined ? 1 : futuresRiskScore >= 82 ? 0.48 : futuresRiskScore >= 64 ? 0.72 : futuresRiskScore >= 45 ? 0.9 : 1.04, "Futures leverage stress reduces noisy learning impact"),
    factor("leveragedTrapProbability", leveragedTrapProbability, leveragedTrapProbability === undefined ? 1 : leveragedTrapProbability >= 78 ? 0.5 : leveragedTrapProbability >= 60 ? 0.74 : 1.02, "Late long/short trap probability limits overfitting"),
    factor("squeezeProbability", squeezeProbability, squeezeProbability === undefined ? 1 : squeezeProbability >= 82 ? 0.58 : squeezeProbability >= 65 ? 0.8 : 1, "Squeeze-prone markets get lower memory impact"),
    factor("regimeStabilityScore", regimeStabilityScore, regimeStabilityScore === undefined ? 1 : regimeStabilityScore >= 76 ? 1.12 : regimeStabilityScore >= 58 ? 1 : regimeStabilityScore >= 38 ? 0.76 : 0.55, "Stable regimes produce more reusable learning samples"),
    factor("regimeTransitionProbability", regimeTransitionProbability, regimeTransitionProbability === undefined ? 1 : regimeTransitionProbability >= 78 ? 0.48 : regimeTransitionProbability >= 62 ? 0.66 : regimeTransitionProbability >= 42 ? 0.86 : 1.04, "Transition phases reduce memory authority"),
    factor("regimeFlipRisk", regimeFlipRisk, regimeFlipRisk === undefined ? 1 : regimeFlipRisk >= 76 ? 0.5 : regimeFlipRisk >= 58 ? 0.72 : regimeFlipRisk >= 38 ? 0.9 : 1.02, "Flip risk limits overfitting to unstable states"),
    factor("regimeChaosProbability", regimeChaosProbability, regimeChaosProbability === undefined ? 1 : regimeChaosProbability >= 82 ? 0.44 : regimeChaosProbability >= 64 ? 0.66 : regimeChaosProbability >= 44 ? 0.86 : 1.02, "Chaos probability protects pattern memory"),
    factor("regimeChopWarning", regimeChopWarning, regimeChopWarning ? 0.58 : 1, "Rapid switching/chop samples are weaker learning evidence"),
    factor("fakeSpikeScore", fakeSpikeScore, fakeSpikeScore === undefined ? 1 : fakeSpikeScore >= 2.8 ? 0.42 : fakeSpikeScore >= 1.8 ? 0.66 : fakeSpikeScore >= 0.9 ? 0.88 : 1.04, "Fake spike risk reduces learning impact"),
    factor("pumpRisk", pumpRisk, pumpRisk === undefined ? 1 : pumpRisk >= 78 ? 0.48 : pumpRisk >= 55 ? 0.7 : pumpRisk >= 30 ? 0.92 : 1.04, "Pump risk avoids overfitting random pumps"),
    factor("spreadQuality", spreadPercent, spreadPercent === undefined ? 1 : spreadPercent <= 0.08 ? 1.08 : spreadPercent <= 0.18 ? 1 : spreadPercent <= 0.35 ? 0.72 : 0.5, "Wide spread lowers execution reliability"),
    factor("liquidityDepth", liquidityDepth, liquidityDepth === undefined || liquidityDepth <= 0 ? 0.88 : liquidityDepth >= 1_000_000 ? 1.08 : liquidityDepth >= 150_000 ? 1 : 0.76, "Thin liquidity creates noisy samples"),
    factor("mtfAlignment", mtfAlignment, mtfAlignment === undefined ? 1 : mtfAlignment >= 78 ? 1.16 : mtfAlignment >= 60 ? 1 : mtfAlignment >= 42 ? 0.72 : 0.52, "Higher timeframe agreement improves statistical quality"),
    factor("signalCleanliness", input.signalCleanliness, input.signalCleanliness === undefined ? 1 : 0.72 + clamp(input.signalCleanliness, 0, 100) / 250, "Clean signal structure gets stronger memory impact"),
    factor("setupQuality", qualityScore, qualityScore === undefined ? 1 : qualityScore >= 82 ? 1.18 : qualityScore >= 68 ? 1.06 : qualityScore >= 52 ? 0.86 : 0.6, "Setup quality gates noisy samples"),
    factor("slippageSeverity", slippageSeverity, slippageSeverity === undefined ? 1 : slippageSeverity <= 0.08 ? 1.06 : slippageSeverity <= 0.25 ? 0.9 : slippageSeverity <= 0.6 ? 0.66 : 0.45, "Slippage reduces execution-quality learning"),
    factor("executionQuality", input.executionQuality, input.executionQuality === undefined ? 1 : 0.72 + clamp(input.executionQuality, 0, 100) / 250, "Execution quality changes how much the result should teach"),
    factor("orderbookStability", round(orderbookStability, 2), 0.74 + clamp(orderbookStability, 0, 100) / 300, "Stable orderbook samples are more reusable"),
    factor("aiConfidence", aiConfidence, aiConfidence === undefined ? 1 : aiConfidence >= 88 ? 1.14 : aiConfidence >= 68 ? 1.04 : aiConfidence >= 48 ? 0.86 : 0.62, "Low AI confidence limits learning authority"),
    factor("postTradeCriticConfidence", criticConfidence, criticConfidence === undefined ? 1 : criticConfidence >= 78 ? 1.1 : criticConfidence >= 55 ? 1 : 0.82, "Confident forensic critic improves learning signal"),
    factor("criticVerdict", criticVerdict, criticVerdict === "SCALE_UP" ? 1.12 : criticVerdict === "PAUSE_SETUP" ? 0.55 : criticVerdict === "TIGHTEN_FILTERS" ? 0.75 : 1, "Post-trade critic adjusts memory impact"),
    factor(
      "regimeCompatibility",
      regimeCompatibility?.status,
      regimeCompatibility?.penaltyMultiplier ?? 1,
      regimeCompatibility?.explanation ?? "Strategy/regime compatibility not available",
    ),
    factor("deepTradeQuality", tradeQuality, tradeQuality === "CLEAN" ? 1.2 : tradeQuality === "ACCEPTABLE" ? 1 : tradeQuality === "WEAK" ? 0.64 : tradeQuality === "DANGEROUS" ? 0.36 : 1, "Deep analysis quality controls noisy memory"),
    factor("anomalyPolicy", policyRecommendation, policyRecommendation === "BOOST" ? 1.12 : policyRecommendation === "BLOCK" ? 0.42 : policyRecommendation === "TIGHTEN" ? 0.68 : 1, "Anomaly/forensic policy normalizes impact"),
  ];

  const rawWeight = factors.reduce((acc, item) => acc * item.multiplier, 1);
  const regimeNormalizer = resolveRegimeNormalizer(marketRegime);
  const normalizedWeight = rawWeight * regimeNormalizer;
  const weight = round(clamp(normalizedWeight, 0.12, 2.25));
  const confidenceInputs = [regimeConfidence, qualityScore, aiConfidence, criticConfidence].filter((x): x is number => x !== undefined);
  const confidence = round(confidenceInputs.length ? confidenceInputs.reduce((acc, value) => acc + value, 0) / confidenceInputs.length : 55, 2);
  const label = labelFor(weight);
  return {
    weight,
    rawWeight: round(rawWeight),
    normalizedWeight: round(normalizedWeight),
    regimeNormalizer: round(regimeNormalizer),
    confidence,
    label,
    factors,
    summary: `learningWeight=${weight} label=${label} regime=${marketRegime || "UNKNOWN"} confidence=${confidence}`,
    generatedAt: new Date().toISOString(),
  };
}
