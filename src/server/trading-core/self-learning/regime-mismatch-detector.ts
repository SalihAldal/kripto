export type RegimeCompatibilityStatus =
  | "REGIME_MATCH"
  | "REGIME_PARTIAL_MATCH"
  | "REGIME_MISMATCH"
  | "HIGH_RISK_REGIME_CONFLICT";

export type StrategyFamily =
  | "BREAKOUT"
  | "TREND"
  | "MEAN_REVERSION"
  | "BOUNCE"
  | "VOLATILITY_DEFENSIVE"
  | "SCALPING"
  | "NO_TRADE"
  | "UNKNOWN";

export type RegimeCompatibilityAnalysis = {
  status: RegimeCompatibilityStatus;
  strategyFamily: StrategyFamily;
  marketRegime?: string;
  compatibilityScore: number;
  penaltyMultiplier: number;
  confidence: number;
  explanation: string;
  evidence: string[];
  learningTags: string[];
  recommendedAction: "BOOST_LEARNING" | "NORMAL_LEARNING" | "REDUCE_WEIGHT" | "STRONG_PENALTY";
  generatedAt: string;
};

export type RegimeCompatibilityInput = {
  strategy?: string;
  entryLogic?: string;
  marketRegime?: string;
  regimeConfidence?: number;
  volatilityPercent?: number;
  momentumPercent?: number;
  shortMomentumPercent?: number;
  liquidityDepth?: number;
  spreadPercent?: number;
  fundingRate?: number;
  openInterest?: number;
  liquidationImbalance?: number;
  fakeSpikeScore?: number;
  pumpRisk?: number;
  mtfAlignment?: number;
  executionTiming?: string;
  historicalExpectancyPercent?: number;
};

function finite(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function optionalNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function tag(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/_+/g, "_").slice(0, 72);
}

export function classifyStrategyFamily(strategy?: string, entryLogic?: string): StrategyFamily {
  const text = `${strategy ?? ""} ${entryLogic ?? ""}`.toUpperCase();
  if (!text.trim()) return "UNKNOWN";
  if (text.includes("NO_TRADE") || text.includes("MICRO_RISK")) return "NO_TRADE";
  if (text.includes("VOLATILITY_DEFENSIVE") || text.includes("DEFENSIVE")) return "VOLATILITY_DEFENSIVE";
  if (text.includes("BREAKOUT") || text.includes("VOLUME-SPIKE") || text.includes("VOLUME_SPIKE")) return "BREAKOUT";
  if (text.includes("RANGE_MEAN_REVERSION") || text.includes("MEAN_REVERSION") || text.includes("SCALPING")) return text.includes("SCALPING") ? "SCALPING" : "MEAN_REVERSION";
  if (text.includes("BOUNCE")) return "BOUNCE";
  if (text.includes("TREND") || text.includes("PULLBACK") || text.includes("RSI-MACD") || text.includes("RSI_MACD")) return "TREND";
  return "UNKNOWN";
}

function baseCompatibility(strategyFamily: StrategyFamily, regime?: string) {
  const normalized = String(regime ?? "UNKNOWN").toUpperCase();
  if (strategyFamily === "NO_TRADE") return normalized.includes("LOW_VOLUME") || normalized.includes("MANIPULATION") ? 82 : 64;
  if (normalized.includes("MANIPULATION")) return strategyFamily === "VOLATILITY_DEFENSIVE" ? 46 : 18;
  if (normalized.includes("LOW_VOLUME")) return strategyFamily === "VOLATILITY_DEFENSIVE" ? 42 : 20;
  if (normalized.includes("HIGH_VOLATILITY") || normalized.includes("NEWS_DRIVEN")) {
    if (strategyFamily === "VOLATILITY_DEFENSIVE") return 74;
    if (strategyFamily === "BREAKOUT") return 58;
    return 36;
  }
  if (normalized.includes("LOW_VOLATILITY")) {
    if (strategyFamily === "MEAN_REVERSION" || strategyFamily === "SCALPING" || strategyFamily === "BOUNCE") return 76;
    if (strategyFamily === "BREAKOUT") return 24;
    return 52;
  }
  if (normalized.includes("SIDEWAYS") || normalized.includes("RANGE")) {
    if (strategyFamily === "MEAN_REVERSION" || strategyFamily === "SCALPING" || strategyFamily === "BOUNCE") return 78;
    if (strategyFamily === "BREAKOUT") return 34;
    if (strategyFamily === "TREND") return 48;
    return 56;
  }
  if (normalized.includes("ROCKET_PUMP")) {
    if (strategyFamily === "BREAKOUT" || strategyFamily === "TREND") return 76;
    if (strategyFamily === "MEAN_REVERSION") return 28;
    return 48;
  }
  if (normalized.includes("STRONG_BULLISH") || normalized.includes("TRENDING_BULLISH")) {
    if (strategyFamily === "BREAKOUT" || strategyFamily === "TREND") return 84;
    if (strategyFamily === "MEAN_REVERSION") return 32;
    if (strategyFamily === "BOUNCE") return 46;
    return 58;
  }
  if (normalized.includes("WEAK_BULLISH") || normalized.includes("WEAK_BEARISH")) {
    if (strategyFamily === "TREND" || strategyFamily === "MEAN_REVERSION" || strategyFamily === "BOUNCE") return 66;
    if (strategyFamily === "BREAKOUT") return 54;
    return 56;
  }
  if (normalized.includes("STRONG_BEARISH") || normalized.includes("TRENDING_BEARISH")) {
    if (strategyFamily === "VOLATILITY_DEFENSIVE" || strategyFamily === "BOUNCE") return 72;
    if (strategyFamily === "BREAKOUT" || strategyFamily === "TREND") return 42;
    if (strategyFamily === "MEAN_REVERSION") return 38;
    return 50;
  }
  return 55;
}

function statusFromScore(score: number, highRisk: boolean): RegimeCompatibilityStatus {
  if (highRisk || score < 28) return "HIGH_RISK_REGIME_CONFLICT";
  if (score < 45) return "REGIME_MISMATCH";
  if (score < 68) return "REGIME_PARTIAL_MATCH";
  return "REGIME_MATCH";
}

function penaltyFromStatus(status: RegimeCompatibilityStatus) {
  if (status === "HIGH_RISK_REGIME_CONFLICT") return 0.38;
  if (status === "REGIME_MISMATCH") return 0.58;
  if (status === "REGIME_PARTIAL_MATCH") return 0.82;
  return 1.08;
}

export function detectRegimeMismatch(input: RegimeCompatibilityInput): RegimeCompatibilityAnalysis {
  const strategyFamily = classifyStrategyFamily(input.strategy, input.entryLogic);
  const regime = String(input.marketRegime ?? "UNKNOWN");
  const regimeUpper = regime.toUpperCase();
  const volatility = optionalNumber(input.volatilityPercent);
  const momentum = optionalNumber(input.shortMomentumPercent ?? input.momentumPercent);
  const spread = optionalNumber(input.spreadPercent);
  const mtf = optionalNumber(input.mtfAlignment);
  const liquidationImbalance = optionalNumber(input.liquidationImbalance);
  const fakeSpike = optionalNumber(input.fakeSpikeScore);
  const pumpRisk = optionalNumber(input.pumpRisk);
  const fundingRate = optionalNumber(input.fundingRate);
  const historicalExpectancy = optionalNumber(input.historicalExpectancyPercent);
  const evidence: string[] = [];
  let score = baseCompatibility(strategyFamily, regime);

  if (input.regimeConfidence !== undefined) {
    const confidence = finite(input.regimeConfidence);
    score += confidence >= 78 ? 4 : confidence < 48 ? -6 : 0;
    evidence.push(`regimeConfidence=${confidence.toFixed(2)}`);
  }
  if (strategyFamily === "BREAKOUT" && (regimeUpper.includes("LOW_VOLATILITY") || regimeUpper.includes("SIDEWAYS") || regimeUpper.includes("RANGE"))) {
    score -= 16;
    evidence.push("Breakout strategy range/low-volatility regime ile zayif uyumlu.");
  }
  if (strategyFamily === "MEAN_REVERSION" && (regimeUpper.includes("STRONG_BULLISH") || regimeUpper.includes("ROCKET_PUMP") || regimeUpper.includes("TRENDING_BULLISH"))) {
    score -= 18;
    evidence.push("Mean reversion guclu trend/pump rejiminde counter-trend risk tasiyor.");
  }
  if (strategyFamily === "BOUNCE" && (regimeUpper.includes("STRONG_BULLISH") || regimeUpper.includes("ROCKET_PUMP"))) {
    score -= 8;
    evidence.push("Bounce logic guclu yukari trendde firsat kacirma veya ters yon riski tasir.");
  }
  if (volatility !== undefined) {
    if (strategyFamily === "BREAKOUT" && volatility < 0.45) score -= 10;
    if ((strategyFamily === "MEAN_REVERSION" || strategyFamily === "SCALPING") && volatility > 3.2) score -= 12;
    if (volatility > 4.5) score -= 8;
    evidence.push(`volatility=${volatility.toFixed(4)}%`);
  }
  if (momentum !== undefined) {
    if (strategyFamily === "BREAKOUT" && Math.abs(momentum) < 0.08) score -= 8;
    if (strategyFamily === "MEAN_REVERSION" && Math.abs(momentum) > 0.8) score -= 10;
    evidence.push(`momentum=${momentum.toFixed(4)}%`);
  }
  if (mtf !== undefined) {
    score += mtf >= 72 ? 8 : mtf < 45 ? -12 : 0;
    evidence.push(`mtfAlignment=${mtf.toFixed(2)}`);
  }
  if (spread !== undefined) {
    score += spread <= 0.08 ? 4 : spread >= 0.22 ? -8 : 0;
    evidence.push(`spread=${spread.toFixed(4)}%`);
  }
  const manipulationHigh = finite(fakeSpike) >= 1.8 || finite(pumpRisk) >= 60 || Math.abs(finite(liquidationImbalance)) >= 0.45;
  if (manipulationHigh) {
    score -= strategyFamily === "VOLATILITY_DEFENSIVE" ? 8 : 18;
    evidence.push("Manipulation/futures imbalance evidence yuksek.");
  }
  if (fundingRate !== undefined && Math.abs(fundingRate) >= 0.0008) {
    score -= 5;
    evidence.push(`fundingRate=${fundingRate.toFixed(6)}`);
  }
  if (historicalExpectancy !== undefined) {
    score += historicalExpectancy > 0.2 ? 8 : historicalExpectancy < -0.1 ? -12 : 0;
    evidence.push(`historicalExpectancy=${historicalExpectancy.toFixed(4)}%`);
  }
  const executionTiming = String(input.executionTiming ?? "").toUpperCase();
  if (executionTiming.includes("WAIT") || executionTiming.includes("NO_ENTRY") || executionTiming.includes("LATE")) {
    score -= 8;
    evidence.push(`executionTiming=${input.executionTiming}`);
  }

  score = clamp(Number(score.toFixed(2)), 0, 100);
  const highRisk =
    (regimeUpper.includes("MANIPULATION") && strategyFamily !== "VOLATILITY_DEFENSIVE" && strategyFamily !== "NO_TRADE") ||
    (strategyFamily === "BREAKOUT" && (regimeUpper.includes("LOW_VOLATILITY") || regimeUpper.includes("SIDEWAYS") || regimeUpper.includes("RANGE")) && Math.abs(finite(momentum)) < 0.08) ||
    (strategyFamily === "MEAN_REVERSION" && (regimeUpper.includes("STRONG_BULLISH") || regimeUpper.includes("ROCKET_PUMP")) && Math.abs(finite(momentum)) > 0.55) ||
    (manipulationHigh && score < 42);
  const status = statusFromScore(score, highRisk);
  const penaltyMultiplier = penaltyFromStatus(status);
  const confidence = clamp(
    (finite(input.regimeConfidence, 60) * 0.34) +
      (mtf !== undefined ? mtf * 0.22 : 12) +
      (volatility !== undefined ? 18 : 10) +
      (evidence.length * 4),
    35,
    95,
  );
  const recommendedAction =
    status === "HIGH_RISK_REGIME_CONFLICT"
      ? "STRONG_PENALTY"
      : status === "REGIME_MISMATCH"
        ? "REDUCE_WEIGHT"
        : status === "REGIME_PARTIAL_MATCH"
          ? "NORMAL_LEARNING"
          : "BOOST_LEARNING";
  const explanation =
    status === "REGIME_MATCH"
      ? `${strategyFamily} strategy mevcut ${regime} rejimiyle uyumlu; setup sonucu regime acisindan tekrar ogrenilebilir.`
      : status === "REGIME_PARTIAL_MATCH"
        ? `${strategyFamily} strategy ${regime} rejiminde kismen uyumlu; ek teyit ve history ile agirliklandirilmali.`
        : status === "REGIME_MISMATCH"
          ? `${strategyFamily} strategy ${regime} rejimiyle uyumsuz; teknik sinyal dogru olsa bile regime edge zayif olabilir.`
          : `${strategyFamily} strategy ${regime} rejiminde yuksek riskli conflict uretti; learning weight dusurulmeli ve tekrarlar cezalandirilmali.`;
  return {
    status,
    strategyFamily,
    marketRegime: input.marketRegime,
    compatibilityScore: score,
    penaltyMultiplier,
    confidence: Number(confidence.toFixed(2)),
    explanation,
    evidence,
    learningTags: [
      `regime_compatibility:${tag(status)}`,
      `strategy_family:${tag(strategyFamily)}`,
      `regime_strategy:${tag(`${strategyFamily}:${regime}`)}`,
      status === "REGIME_MISMATCH" || status === "HIGH_RISK_REGIME_CONFLICT" ? "root:regime_mismatch" : "root:regime_compatible",
    ],
    recommendedAction,
    generatedAt: new Date().toISOString(),
  };
}
