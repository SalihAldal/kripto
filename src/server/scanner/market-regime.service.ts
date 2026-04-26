export type MarketRegime =
  | "STRONG_BULLISH_TREND"
  | "WEAK_BULLISH_TREND"
  | "STRONG_BEARISH_TREND"
  | "WEAK_BEARISH_TREND"
  | "RANGE_SIDEWAYS"
  | "HIGH_VOLATILITY_CHAOS"
  | "LOW_VOLUME_DEAD_MARKET"
  | "NEWS_DRIVEN_UNSTABLE";

export type TradingAggressiveness = "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH";

export type StrategyType =
  | "BREAKOUT_CONTINUATION"
  | "BREAKOUT_RETEST"
  | "TREND_PULLBACK"
  | "BOUNCE_ONLY"
  | "RANGE_MEAN_REVERSION"
  | "VOLATILITY_DEFENSIVE"
  | "NO_TRADE_OR_MICRO_RISK";

export type MarketRegimeSnapshot = {
  regime: MarketRegime;
  confidenceScore: number;
  reason: string;
  marketSummary: string;
  selectedStrategy: StrategyType;
  allowedStrategyTypes: StrategyType[];
  forbiddenStrategyTypes: StrategyType[];
  tradingAggressiveness: TradingAggressiveness;
  entryThresholdScore: number;
  openTradeAllowed: boolean;
  tpMultiplier: number;
  slMultiplier: number;
  riskMultiplier: number;
};

type DetectRegimeInput = {
  trendStrength: number;
  momentumPercent: number;
  shortMomentumPercent: number;
  volatilityPercent: number;
  spreadPercent: number;
  fakeSpikeScore: number;
  volume24h: number;
  minVolumeThreshold: number;
  shortFlowImbalance: number;
  newsSentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  socialSentimentScore?: number;
  btcDominanceBias?: number;
};

function abs(value: number) {
  return Math.abs(Number(value || 0));
}

export function detectMarketRegime(input: DetectRegimeInput): MarketRegimeSnapshot {
  const momentum = Number(input.momentumPercent || 0);
  const shortMomentum = Number(input.shortMomentumPercent || 0);
  const trendStrength = abs(input.trendStrength);
  const volatility = Number(input.volatilityPercent || 0);
  const spread = Number(input.spreadPercent || 0);
  const fakeSpike = Number(input.fakeSpikeScore || 0);
  const volume = Number(input.volume24h || 0);
  const flow = Number(input.shortFlowImbalance || 0);
  const newsSentiment = input.newsSentiment ?? "NEUTRAL";
  const socialSentiment = Number(input.socialSentimentScore ?? 50);
  const btcDominance = Number(input.btcDominanceBias ?? 0);
  const lowVolume = volume < input.minVolumeThreshold;
  const chaos = volatility >= 2.8 || fakeSpike >= 2.3 || spread >= 0.22;
  const newsUnstable =
    (newsSentiment !== "NEUTRAL" && abs(shortMomentum) > 0.85 && volatility > 1.8) ||
    (newsSentiment === "NEUTRAL" && socialSentiment > 78 && abs(shortMomentum) > 0.9 && flow < 0.04);

  const trendDirection = momentum >= 0 ? 1 : -1;
  const trendDirectionalScore =
    trendStrength * 35 +
    abs(momentum) * 30 +
    abs(shortMomentum) * 20 +
    abs(flow) * 15;
  const confidenceBase = Math.max(0, Math.min(100, 35 + trendDirectionalScore));

  const baseAllowed: StrategyType[] = [
    "TREND_PULLBACK",
    "BREAKOUT_CONTINUATION",
    "BREAKOUT_RETEST",
    "RANGE_MEAN_REVERSION",
    "BOUNCE_ONLY",
  ];
  const allStrategies = new Set<StrategyType>([
    ...baseAllowed,
    "VOLATILITY_DEFENSIVE",
    "NO_TRADE_OR_MICRO_RISK",
  ]);
  const forbiddenFromAllowed = (allowed: StrategyType[]) => {
    const allowSet = new Set(allowed);
    return Array.from(allStrategies).filter((x) => !allowSet.has(x));
  };

  if (lowVolume) {
    const allowed: StrategyType[] = ["NO_TRADE_OR_MICRO_RISK"];
    return {
      regime: "LOW_VOLUME_DEAD_MARKET",
      confidenceScore: 92,
      reason: `Hacim dusuk (24h=${volume.toFixed(2)} < ${input.minVolumeThreshold.toFixed(2)}), likidite zayif.`,
      marketSummary: "Likidite yetersiz. No-trade veya mikro-risk disinda agresif aksiyon uygun degil.",
      selectedStrategy: "NO_TRADE_OR_MICRO_RISK",
      allowedStrategyTypes: allowed,
      forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
      tradingAggressiveness: "VERY_LOW",
      entryThresholdScore: 88,
      openTradeAllowed: false,
      tpMultiplier: 0.85,
      slMultiplier: 0.9,
      riskMultiplier: 0.15,
    };
  }

  if (newsUnstable) {
    const allowed: StrategyType[] = ["VOLATILITY_DEFENSIVE", "NO_TRADE_OR_MICRO_RISK"];
    return {
      regime: "NEWS_DRIVEN_UNSTABLE",
      confidenceScore: 84,
      reason: `Haber/sentiment kaynakli oynaklik artisi (news=${newsSentiment}, social=${socialSentiment.toFixed(1)}).`,
      marketSummary: "Haber kaynakli dengesiz market. Momentum var gibi gorunse de ters hareket riski yuksek.",
      selectedStrategy: "VOLATILITY_DEFENSIVE",
      allowedStrategyTypes: allowed,
      forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
      tradingAggressiveness: "VERY_LOW",
      entryThresholdScore: 86,
      openTradeAllowed: true,
      tpMultiplier: 0.86,
      slMultiplier: 0.78,
      riskMultiplier: 0.42,
    };
  }

  if (chaos) {
    const allowed: StrategyType[] = ["VOLATILITY_DEFENSIVE", "NO_TRADE_OR_MICRO_RISK"];
    return {
      regime: "HIGH_VOLATILITY_CHAOS",
      confidenceScore: 90,
      reason: `Volatilite kaotik (vol=${volatility.toFixed(3)} spread=${spread.toFixed(3)} fakeSpike=${fakeSpike.toFixed(2)}).`,
      marketSummary: "Market kaotik. Trade frekansi ciddi azaltilmali, spread/wick filtresi sert olmali.",
      selectedStrategy: "VOLATILITY_DEFENSIVE",
      allowedStrategyTypes: allowed,
      forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
      tradingAggressiveness: "VERY_LOW",
      entryThresholdScore: 82,
      openTradeAllowed: true,
      tpMultiplier: 0.92,
      slMultiplier: 0.82,
      riskMultiplier: 0.45,
    };
  }

  const strongBullish =
    trendStrength >= 0.6 &&
    momentum >= 0.38 &&
    shortMomentum >= 0.1 &&
    flow >= -0.02 &&
    btcDominance < 0.65;
  if (strongBullish) {
    const allowed: StrategyType[] = ["BREAKOUT_CONTINUATION", "BREAKOUT_RETEST", "TREND_PULLBACK"];
    return {
      regime: "STRONG_BULLISH_TREND",
      confidenceScore: Math.max(72, Math.min(98, Math.round(confidenceBase))),
      reason: `Guclu yukselis trendi (trend=${trendStrength.toFixed(2)}, momentum=${momentum.toFixed(2)}).`,
      marketSummary: "Trend continuation market. Breakout + retest ve pullback girisleri oncelikli.",
      selectedStrategy: "BREAKOUT_CONTINUATION",
      allowedStrategyTypes: allowed,
      forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
      tradingAggressiveness: "HIGH",
      entryThresholdScore: 58,
      openTradeAllowed: true,
      tpMultiplier: 1.25,
      slMultiplier: 1.15,
      riskMultiplier: 1.12,
    };
  }

  const weakBullish =
    trendDirection > 0 &&
    trendStrength >= 0.25 &&
    momentum >= 0.12 &&
    shortMomentum >= 0 &&
    !strongBullish;
  if (weakBullish) {
    const allowed: StrategyType[] = ["TREND_PULLBACK", "BREAKOUT_RETEST", "RANGE_MEAN_REVERSION"];
    return {
      regime: "WEAK_BULLISH_TREND",
      confidenceScore: Math.max(58, Math.min(82, Math.round(confidenceBase - 8))),
      reason: `Zayif yukselis trendi (trend=${trendStrength.toFixed(2)}, momentum=${momentum.toFixed(2)}).`,
      marketSummary: "Yukari yone egilim var ama kirilimlar her zaman kalici degil; daha secici trade gerekir.",
      selectedStrategy: "TREND_PULLBACK",
      allowedStrategyTypes: allowed,
      forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
      tradingAggressiveness: "MEDIUM",
      entryThresholdScore: 66,
      openTradeAllowed: true,
      tpMultiplier: 1.08,
      slMultiplier: 1.02,
      riskMultiplier: 0.9,
    };
  }

  const strongBearish =
    trendStrength >= 0.6 &&
    momentum <= -0.38 &&
    shortMomentum <= -0.1 &&
    flow <= 0.02;
  if (strongBearish) {
    const allowed: StrategyType[] = ["BOUNCE_ONLY", "VOLATILITY_DEFENSIVE"];
    return {
      regime: "STRONG_BEARISH_TREND",
      confidenceScore: Math.max(74, Math.min(98, Math.round(confidenceBase))),
      reason: `Guclu dusus trendi (trend=${trendStrength.toFixed(2)}, momentum=${momentum.toFixed(2)}).`,
      marketSummary: "Sert dusus trendi. Sadece cok guclu bounce setup'lari ve korumali aksiyonlar kabul edilir.",
      selectedStrategy: "BOUNCE_ONLY",
      allowedStrategyTypes: allowed,
      forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
      tradingAggressiveness: "LOW",
      entryThresholdScore: 78,
      openTradeAllowed: true,
      tpMultiplier: 0.86,
      slMultiplier: 0.8,
      riskMultiplier: 0.46,
    };
  }

  const weakBearish =
    trendDirection < 0 &&
    trendStrength >= 0.25 &&
    momentum <= -0.12 &&
    shortMomentum <= 0 &&
    !strongBearish;
  if (weakBearish) {
    const allowed: StrategyType[] = ["BOUNCE_ONLY", "RANGE_MEAN_REVERSION", "VOLATILITY_DEFENSIVE"];
    return {
      regime: "WEAK_BEARISH_TREND",
      confidenceScore: Math.max(56, Math.min(80, Math.round(confidenceBase - 9))),
      reason: `Zayif dusus trendi (trend=${trendStrength.toFixed(2)}, momentum=${momentum.toFixed(2)}).`,
      marketSummary: "Asagi yone egilim var. Zayif bounce kovalamak yasak, trade seciciligi yuksek olmali.",
      selectedStrategy: "BOUNCE_ONLY",
      allowedStrategyTypes: allowed,
      forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
      tradingAggressiveness: "LOW",
      entryThresholdScore: 74,
      openTradeAllowed: true,
      tpMultiplier: 0.94,
      slMultiplier: 0.88,
      riskMultiplier: 0.6,
    };
  }

  const allowed: StrategyType[] = ["RANGE_MEAN_REVERSION", "BOUNCE_ONLY"];
  return {
    regime: "RANGE_SIDEWAYS",
    confidenceScore: 70,
    reason: `Yatay pazar (trend=${trendStrength.toFixed(2)}, momentum=${momentum.toFixed(2)}, vol=${volatility.toFixed(2)}).`,
    marketSummary: "Range/sideways market. Breakout takipten cok mean reversion setup'lari tercih edilmeli.",
    selectedStrategy: "RANGE_MEAN_REVERSION",
    allowedStrategyTypes: allowed,
    forbiddenStrategyTypes: forbiddenFromAllowed(allowed),
    tradingAggressiveness: "MEDIUM",
    entryThresholdScore: 68,
    openTradeAllowed: true,
    tpMultiplier: 0.82,
    slMultiplier: 0.92,
    riskMultiplier: 0.72,
  };
}
