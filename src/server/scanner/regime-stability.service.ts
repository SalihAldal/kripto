import type { MarketRegimeSnapshot } from "@/src/server/scanner/market-regime.service";

export type RegimeLifecyclePhase =
  | "NEW_REGIME"
  | "STABLE"
  | "TRANSITION"
  | "CHOP"
  | "EXHAUSTION"
  | "VOLATILITY_EXPANSION"
  | "VOLATILITY_COMPRESSION";

export type RegimeStabilitySnapshot = {
  symbol: string;
  regime: string;
  regimeConfidence: number;
  stabilityScore: number;
  regimeAgeSec: number;
  transitionProbability: number;
  flipRisk: number;
  chaosProbability: number;
  persistenceScore: number;
  switchCount10m: number;
  lifecyclePhase: RegimeLifecyclePhase;
  rapidSwitching: boolean;
  trendExhaustion: boolean;
  volatilityExpansion: boolean;
  volatilityCompression: boolean;
  chopWarning: boolean;
  fakeTrendTransition: boolean;
  unstableBreakoutCondition: boolean;
  timeline: Array<{
    regime: string;
    at: string;
    confidence: number;
    stabilityScore: number;
  }>;
  reasons: string[];
  generatedAt: string;
};

type RegimePoint = {
  regime: string;
  confidence: number;
  at: number;
  trendStrength: number;
  momentumPercent: number;
  shortMomentumPercent: number;
  volatilityPercent: number;
  spreadPercent: number;
  fakeSpikeScore: number;
  pumpRisk: number;
  futuresRiskScore: number;
  leverageStressScore: number;
  stabilityScore: number;
};

type StabilityInput = {
  symbol: string;
  marketRegime: MarketRegimeSnapshot;
  trendStrength: number;
  momentumPercent: number;
  shortMomentumPercent: number;
  volatilityPercent: number;
  spreadPercent: number;
  fakeSpikeScore: number;
  pumpRisk: number;
  futuresRiskScore?: number;
  leverageStressScore?: number;
};

const HISTORY_WINDOW_MS = 30 * 60_000;
const SWITCH_WINDOW_MS = 10 * 60_000;
const MAX_POINTS_PER_SYMBOL = 80;
const history = new Map<string, RegimePoint[]>();

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function normalize(value: number, scale: number) {
  return clamp(Math.abs(value) / Math.max(scale, 0.0001) * 100);
}

function direction(value: number, deadZone = 0.04) {
  if (value > deadZone) return 1;
  if (value < -deadZone) return -1;
  return 0;
}

function countSwitches(points: RegimePoint[]) {
  let switches = 0;
  for (let idx = 1; idx < points.length; idx += 1) {
    if (points[idx]?.regime !== points[idx - 1]?.regime) switches += 1;
  }
  return switches;
}

function firstSeenAt(points: RegimePoint[], regime: string, fallback: number) {
  for (let idx = points.length - 1; idx >= 0; idx -= 1) {
    if (points[idx]?.regime !== regime) return points[idx + 1]?.at ?? fallback;
  }
  return points[0]?.at ?? fallback;
}

export function recordRegimeStability(input: StabilityInput): RegimeStabilitySnapshot {
  const now = Date.now();
  const symbol = input.symbol.toUpperCase();
  const existing = history.get(symbol) ?? [];
  const recent = existing.filter((point) => now - point.at <= HISTORY_WINDOW_MS);
  const previous = recent[recent.length - 1];
  const currentRegime = input.marketRegime.regime;
  const confidence = clamp(Number(input.marketRegime.confidenceScore ?? 60));
  const recent10m = recent.filter((point) => now - point.at <= SWITCH_WINDOW_MS);
  const switchCount10m = countSwitches([...recent10m, {
    regime: currentRegime,
    confidence,
    at: now,
    trendStrength: input.trendStrength,
    momentumPercent: input.momentumPercent,
    shortMomentumPercent: input.shortMomentumPercent,
    volatilityPercent: input.volatilityPercent,
    spreadPercent: input.spreadPercent,
    fakeSpikeScore: input.fakeSpikeScore,
    pumpRisk: input.pumpRisk,
    futuresRiskScore: Number(input.futuresRiskScore ?? 0),
    leverageStressScore: Number(input.leverageStressScore ?? 0),
    stabilityScore: confidence,
  }]);
  const sameRegimeCount = recent10m.filter((point) => point.regime === currentRegime).length;
  const persistenceScore = clamp((sameRegimeCount / Math.max(1, recent10m.length)) * 100);
  const regimeStartedAt = firstSeenAt(recent, currentRegime, now);
  const regimeAgeSec = Math.max(0, Math.round((now - regimeStartedAt) / 1000));
  const trendDelta = previous ? input.trendStrength - previous.trendStrength : 0;
  const momentumDelta = previous ? input.shortMomentumPercent - previous.shortMomentumPercent : 0;
  const volatilityDelta = previous ? input.volatilityPercent - previous.volatilityPercent : 0;
  const wickRiskDelta = previous ? input.fakeSpikeScore - previous.fakeSpikeScore : 0;
  const trendDirectionFlip = previous ? direction(input.shortMomentumPercent) !== direction(previous.shortMomentumPercent) : false;
  const trendExhaustion =
    Math.abs(input.trendStrength) > 0.25 &&
    Math.abs(input.shortMomentumPercent) < Math.max(0.05, Math.abs(previous?.shortMomentumPercent ?? input.shortMomentumPercent) * 0.55) &&
    volatilityDelta > 0.08;
  const volatilityExpansion = volatilityDelta > Math.max(0.18, input.volatilityPercent * 0.22);
  const volatilityCompression = volatilityDelta < -Math.max(0.16, Math.abs(previous?.volatilityPercent ?? 0) * 0.18);
  const rapidSwitching = switchCount10m >= 4;
  const chopWarning =
    rapidSwitching ||
    (switchCount10m >= 2 && Math.abs(input.shortMomentumPercent) < 0.12 && input.volatilityPercent > 0.45) ||
    (trendDirectionFlip && Math.abs(input.shortMomentumPercent) < 0.2);
  const fakeTrendTransition =
    (currentRegime.includes("TREND") || currentRegime === "ROCKET_PUMP") &&
    (input.fakeSpikeScore >= 1.6 || input.pumpRisk >= 58) &&
    persistenceScore < 58;
  const unstableBreakoutCondition =
    (currentRegime === "ROCKET_PUMP" || currentRegime.includes("BULLISH")) &&
    (input.spreadPercent > 0.14 || input.futuresRiskScore && input.futuresRiskScore >= 65 || fakeTrendTransition);
  const driftScore =
    normalize(trendDelta, 0.45) * 0.18 +
    normalize(momentumDelta, 0.65) * 0.2 +
    normalize(volatilityDelta, 0.9) * 0.2 +
    normalize(wickRiskDelta, 1.4) * 0.16 +
    switchCount10m * 8 +
    (trendDirectionFlip ? 12 : 0);
  const chaosProbability = clamp(
    input.volatilityPercent * 12 +
      input.spreadPercent * 120 +
      input.fakeSpikeScore * 12 +
      input.pumpRisk * 0.35 +
      Number(input.futuresRiskScore ?? 0) * 0.22 +
      switchCount10m * 6,
  );
  const transitionProbability = clamp(
    driftScore * 0.62 +
      (100 - persistenceScore) * 0.22 +
      (trendExhaustion ? 18 : 0) +
      (volatilityExpansion ? 12 : 0) +
      (fakeTrendTransition ? 14 : 0),
  );
  const flipRisk = clamp(
    (trendDirectionFlip ? 22 : 0) +
      (switchCount10m * 8) +
      (100 - persistenceScore) * 0.28 +
      normalize(momentumDelta, 0.75) * 0.22 +
      (trendExhaustion ? 16 : 0),
  );
  const stabilityScore = clamp(
    confidence * 0.34 +
      persistenceScore * 0.34 +
      Math.max(0, 100 - transitionProbability) * 0.18 +
      Math.max(0, 100 - chaosProbability) * 0.14,
  );
  const lifecyclePhase: RegimeLifecyclePhase =
    chopWarning
      ? "CHOP"
      : trendExhaustion
        ? "EXHAUSTION"
        : transitionProbability >= 62
          ? "TRANSITION"
          : volatilityExpansion
            ? "VOLATILITY_EXPANSION"
            : volatilityCompression
              ? "VOLATILITY_COMPRESSION"
              : regimeAgeSec < 180
                ? "NEW_REGIME"
                : "STABLE";
  const reasons = [
    `regime=${currentRegime}`,
    `age=${regimeAgeSec}s`,
    `switches10m=${switchCount10m}`,
    `persistence=${round(persistenceScore)}`,
    trendExhaustion ? "trend_exhaustion" : "",
    volatilityExpansion ? "volatility_expansion" : "",
    volatilityCompression ? "volatility_compression" : "",
    chopWarning ? "chop_warning" : "",
    fakeTrendTransition ? "fake_trend_transition" : "",
    unstableBreakoutCondition ? "unstable_breakout" : "",
  ].filter(Boolean);
  const point: RegimePoint = {
    regime: currentRegime,
    confidence,
    at: now,
    trendStrength: input.trendStrength,
    momentumPercent: input.momentumPercent,
    shortMomentumPercent: input.shortMomentumPercent,
    volatilityPercent: input.volatilityPercent,
    spreadPercent: input.spreadPercent,
    fakeSpikeScore: input.fakeSpikeScore,
    pumpRisk: input.pumpRisk,
    futuresRiskScore: Number(input.futuresRiskScore ?? 0),
    leverageStressScore: Number(input.leverageStressScore ?? 0),
    stabilityScore,
  };
  const nextHistory = [...recent, point].slice(-MAX_POINTS_PER_SYMBOL);
  history.set(symbol, nextHistory);
  return {
    symbol,
    regime: currentRegime,
    regimeConfidence: round(confidence),
    stabilityScore: round(stabilityScore),
    regimeAgeSec,
    transitionProbability: round(transitionProbability),
    flipRisk: round(flipRisk),
    chaosProbability: round(chaosProbability),
    persistenceScore: round(persistenceScore),
    switchCount10m,
    lifecyclePhase,
    rapidSwitching,
    trendExhaustion,
    volatilityExpansion,
    volatilityCompression,
    chopWarning,
    fakeTrendTransition,
    unstableBreakoutCondition,
    timeline: nextHistory.slice(-12).map((item) => ({
      regime: item.regime,
      at: new Date(item.at).toISOString(),
      confidence: round(item.confidence),
      stabilityScore: round(item.stabilityScore),
    })),
    reasons,
    generatedAt: new Date(now).toISOString(),
  };
}
