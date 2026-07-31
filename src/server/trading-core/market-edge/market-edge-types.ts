import type { BacktestTrade } from "@/src/server/trading-core/backtest/backtest-types";
import type { MarketCandle } from "@/src/server/trading-core/core/types";
import type { LiquidationHeatmapAnalysis } from "@/src/server/trading-core/liquidation-heatmap";
import type { MarketRegimeType } from "@/src/server/trading-core/market-regime";

export type EdgeConditionType =
  | "VOLATILITY_PATTERN"
  | "LIQUIDATION_EVENT"
  | "BREAKOUT_SUCCESS"
  | "FAKE_BREAKOUT"
  | "FUNDING_EXTREME"
  | "VOLUME_ANOMALY"
  | "WHALE_ACTIVITY"
  | "ORDERBOOK_IMBALANCE"
  | "MARKET_INEFFICIENCY";

export type EdgeRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "EXTREME";

export type MarketEdgeSample = {
  symbol: string;
  timestamp: number;
  volatilityPercent?: number;
  fundingRatePercent?: number;
  volumeRatio?: number;
  orderbookImbalancePercent?: number;
  whaleNotionalUsd?: number;
  breakoutDirection?: "UP" | "DOWN" | "NONE";
  breakoutSucceeded?: boolean;
  fakeBreakout?: boolean;
  regime?: MarketRegimeType;
  strategy?: string;
  returnPercent?: number;
};

export type MarketEdgeDiscoveryRequest = {
  symbols?: string[];
  trades?: BacktestTrade[];
  marketData?: Array<{ symbol: string; candles: MarketCandle[] }>;
  samples?: MarketEdgeSample[];
  liquidationHeatmaps?: LiquidationHeatmapAnalysis[];
  minSamples?: number;
  strategies?: string[];
};

export type MarketEdgeCondition = {
  type: EdgeConditionType;
  label: string;
  sampleSize: number;
  winrate: number;
  averageReturnPercent: number;
  edgeScore: number;
  confidence: number;
  riskLevel: EdgeRiskLevel;
  reasons: string[];
};

export type StrategyCompatibility = {
  strategy: string;
  compatibleConditions: EdgeConditionType[];
  avoidedConditions: EdgeConditionType[];
  score: number;
  confidence: number;
  reason: string;
};

export type MarketInefficiency = {
  symbol: string;
  type: EdgeConditionType;
  score: number;
  confidence: number;
  description: string;
};

export type MarketEdgeDiscoveryReport = {
  symbols: string[];
  analyzedTrades: number;
  analyzedSamples: number;
  profitableConditions: MarketEdgeCondition[];
  dangerousConditions: MarketEdgeCondition[];
  strategyCompatibility: StrategyCompatibility[];
  inefficiencies: MarketInefficiency[];
  edgeConfidenceScore: number;
  generatedAt: string;
};
