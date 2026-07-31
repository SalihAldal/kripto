import type { BotAllocation } from "@/src/server/trading-core/bots/bot-types";
import type { PositionSide } from "@/src/server/trading-core/executors/position-types";

export type PortfolioRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type PortfolioAction = "ALLOW" | "REDUCE_SIZE" | "HEDGE" | "BLOCK";

export type PortfolioPositionInput = {
  id: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  strategy?: string;
  botId?: string;
  unrealizedPnl?: number;
  metadata?: Record<string, unknown>;
};

export type PortfolioIntent = {
  symbol: string;
  side: PositionSide;
  requestedNotional: number;
  strategy?: string;
  botAllocation?: BotAllocation;
};

export type PortfolioConfig = {
  maxSingleCoinExposurePercent: number;
  maxCorrelatedExposurePercent: number;
  maxStrategyExposurePercent: number;
  maxTotalExposurePercent: number;
  hedgeThresholdPercent: number;
  rebalanceThresholdPercent: number;
};

export type ExposureBucket = {
  key: string;
  notionalUsd: number;
  exposurePercent: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  netNotionalUsd: number;
};

export type CorrelationExposure = {
  group: string;
  symbols: string[];
  notionalUsd: number;
  exposurePercent: number;
  riskScore: number;
};

export type HedgeRecommendation = {
  symbol: string;
  side: PositionSide;
  hedgeNotionalUsd: number;
  reason: string;
};

export type PortfolioDecision = {
  action: PortfolioAction;
  allowed: boolean;
  riskLevel: PortfolioRiskLevel;
  riskScore: number;
  adjustedNotional: number;
  reasons: string[];
  hedgeRecommendations: HedgeRecommendation[];
};

export type PortfolioAnalysis = {
  userId?: string;
  accountEquity: number;
  totalExposureUsd: number;
  totalExposurePercent: number;
  symbolExposure: ExposureBucket[];
  strategyExposure: ExposureBucket[];
  correlationExposure: CorrelationExposure[];
  riskDistribution: Record<PortfolioRiskLevel, number>;
  recommendedStrategyAllocation: Record<string, number>;
  hedgeRecommendations: HedgeRecommendation[];
  decision?: PortfolioDecision;
  analyzedAt: string;
};
