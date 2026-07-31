import type { MarketAnalysisClientOutput } from "@/src/server/trading-core/ai-engine/market-analysis-client";
import type { SignalDecision, TradeSide } from "@/src/server/trading-core/core/types";
import type { LiquidationHeatmapAnalysis } from "@/src/server/trading-core/liquidation-heatmap";
import type { MarketRegimeDecision } from "@/src/server/trading-core/market-regime";
import type { ProviderConsensus } from "@/src/server/trading-core/signal-providers";

export type FusionSourceType =
  | "TECHNICAL_INDICATORS"
  | "AI_PREDICTIONS"
  | "VOLUME_ANALYSIS"
  | "ORDERBOOK_ANALYSIS"
  | "FUNDING_RATE"
  | "LIQUIDATION_HEATMAP"
  | "MARKET_REGIME"
  | "PROVIDER_CONSENSUS";

export type OrderbookSignalInput = {
  side: TradeSide;
  imbalancePercent: number;
  bidAskSpreadPercent: number;
  confidence: number;
};

export type FundingRateSignalInput = {
  fundingRatePercent: number;
  confidence?: number;
};

export type SignalFusionInput = {
  symbol: string;
  technical?: SignalDecision;
  ai?: MarketAnalysisClientOutput | null;
  volume?: {
    side: TradeSide;
    volumeRatio: number;
    confidence: number;
  };
  orderbook?: OrderbookSignalInput;
  funding?: FundingRateSignalInput;
  liquidationHeatmap?: LiquidationHeatmapAnalysis | null;
  marketRegime?: MarketRegimeDecision | SignalDecision["marketRegime"] | null;
  providerConsensus?: ProviderConsensus | null;
  weights?: Partial<Record<FusionSourceType, number>>;
  minConfidence?: number;
  conflictThreshold?: number;
  noiseThreshold?: number;
};

export type FusionSourceScore = {
  source: FusionSourceType;
  side: TradeSide;
  score: number;
  confidence: number;
  weight: number;
  weightedScore: number;
  reasons: string[];
};

export type SignalFusionOutput = {
  symbol: string;
  side: TradeSide;
  score: number;
  confidence: number;
  conflictScore: number;
  noiseScore: number;
  sourceScores: FusionSourceScore[];
  filteredSources: FusionSourceScore[];
  reasons: string[];
  generatedAt: string;
  output: "json";
};
