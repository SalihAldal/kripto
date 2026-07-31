import type { TradeSide } from "@/src/server/trading-core/core/types";
import type { LiquidationHeatmapAnalysis } from "@/src/server/trading-core/liquidation-heatmap";
import type { MarketRegimeDecision } from "@/src/server/trading-core/market-regime";
import type { SignalFusionOutput } from "@/src/server/trading-core/signal-fusion";

export type TradeQualityFilterType =
  | "LOW_VOLUME"
  | "WEAK_BREAKOUT"
  | "BAD_RISK_REWARD"
  | "FUNDING_EXTREME"
  | "NEWS_SPIKE"
  | "MANIPULATION_RISK"
  | "WIDE_SPREAD"
  | "LOW_LIQUIDITY";

export type TradeQualityAction = "ALLOW" | "REDUCE_SIZE" | "BLOCK";
export type TradeQualityLevel = "A" | "B" | "C" | "D" | "F";

export type TradeQualityInput = {
  symbol: string;
  side: Exclude<TradeSide, "HOLD">;
  entryPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  volumeRatio?: number;
  breakoutStrength?: number;
  spreadPercent?: number;
  liquidityUsd?: number;
  fundingRatePercent?: number;
  newsSpikeScore?: number;
  orderbookDepthUsd?: number;
  signalFusion?: SignalFusionOutput | null;
  marketRegime?: MarketRegimeDecision | null;
  liquidationHeatmap?: LiquidationHeatmapAnalysis | null;
  minQualityScore?: number;
};

export type TradeQualityFilterResult = {
  type: TradeQualityFilterType;
  passed: boolean;
  score: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
};

export type TradeQualityDecision = {
  symbol: string;
  side: Exclude<TradeSide, "HOLD">;
  action: TradeQualityAction;
  allowed: boolean;
  qualityLevel: TradeQualityLevel;
  qualityScore: number;
  probabilityScore: number;
  riskRewardRatio: number;
  filters: TradeQualityFilterResult[];
  blockedReasons: string[];
  sizeMultiplier: number;
  generatedAt: string;
};
