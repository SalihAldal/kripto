import type { BotPerformanceMetrics } from "@/src/server/trading-core/bots/bot-performance-types";
import type { LiquidationHeatmapAnalysis } from "@/src/server/trading-core/liquidation-heatmap";
import type { MarketRegimeDecision } from "@/src/server/trading-core/market-regime";

export type PositionSizingRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export type DynamicPositionSizingConfig = {
  baseRiskPercent: number;
  minNotionalUsd: number;
  maxNotionalUsd: number;
  maxEquityPercent: number;
  highConfidenceBoost: number;
  lowConfidencePenalty: number;
  volatilityTargetPercent: number;
  drawdownHardLimitPercent: number;
  minLiquidationDistancePercent: number;
};

export type DynamicPositionSizingInput = {
  symbol: string;
  side: "BUY" | "SELL";
  accountEquity: number;
  requestedNotional?: number;
  confidenceScore: number;
  volatilityPercent: number;
  drawdownPercent: number;
  liquidationDistancePercent?: number;
  leverage?: number;
  strategy?: string;
  strategySuccessRate?: number;
  botMetrics?: BotPerformanceMetrics | null;
  marketRegime?: MarketRegimeDecision | null;
  liquidationHeatmap?: LiquidationHeatmapAnalysis | null;
  config?: Partial<DynamicPositionSizingConfig>;
};

export type PositionSizingFactor = {
  name: "CONFIDENCE" | "VOLATILITY" | "DRAWDOWN" | "STRATEGY_SUCCESS" | "MARKET_REGIME" | "LIQUIDATION_RISK" | "LEVERAGE";
  multiplier: number;
  score: number;
  reason: string;
};

export type DynamicPositionSizingDecision = {
  symbol: string;
  side: "BUY" | "SELL";
  allowed: boolean;
  riskLevel: PositionSizingRiskLevel;
  baseNotional: number;
  requestedNotional: number;
  adjustedNotional: number;
  positionSizePercent: number;
  leverage: number;
  factors: PositionSizingFactor[];
  reasons: string[];
  generatedAt: string;
};
