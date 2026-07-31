export type MarketRegimeType =
  | "TRENDING_BULLISH"
  | "TRENDING_BEARISH"
  | "SIDEWAYS"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "MANIPULATION_ZONE";

export type TrendDirection = "BULLISH" | "BEARISH" | "SIDEWAYS";

export type StrategyMode = "SCALPING" | "TREND" | "BREAKOUT" | "DEFENSIVE" | "DISABLED";

export type MarketRegimeDecision = {
  symbol: string;
  regime: MarketRegimeType;
  trendDirection: TrendDirection;
  strategyMode: StrategyMode;
  tradeAllowed: boolean;
  confidence: number;
  reasons: string[];
  metrics: {
    volatilityPercent: number;
    trendStrength: number;
    rangePercent: number;
    volumeRatio: number;
    wickAnomalyScore: number;
  };
  detectedAt: string;
};

export type StrategyRegimeRule = {
  strategy: string;
  allowedRegimes: MarketRegimeType[];
  preferredMode: StrategyMode;
};
