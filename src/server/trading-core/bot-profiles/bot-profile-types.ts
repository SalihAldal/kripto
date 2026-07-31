import type { BotPerformanceMetrics } from "@/src/server/trading-core/bots/bot-performance-types";

export type BotProfileRiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type BotStrategyType = "SCALPING" | "TREND" | "BREAKOUT" | "MEAN_REVERSION" | "GRID" | "AI_ASSISTED";
export type BotTradeFrequency = "LOW" | "MEDIUM" | "HIGH" | "ULTRA";

export type BotPerformancePoint = {
  timestamp: string;
  pnl: number;
  drawdown: number;
  winrate: number;
  aiConfidence: number;
};

export type BotProfileRating = {
  ratingId: string;
  botId: string;
  userId: string;
  stars: number;
  comment?: string;
  createdAt: string;
};

export type TradingBotProfile = {
  botId: string;
  name: string;
  description: string;
  riskLevel: BotProfileRiskLevel;
  supportedPairs: string[];
  strategyType: BotStrategyType;
  recommendedLeverage: number;
  tradeFrequency: BotTradeFrequency;
  aiConfidence: number;
  tags: string[];
  ratingAverage: number;
  ratingCount: number;
  metrics: BotPerformanceMetrics;
  monthlyPnl: number;
  maxDrawdown: number;
  performanceCurve: BotPerformancePoint[];
  createdAt: string;
  updatedAt: string;
};

export type BotProfileUpsertInput = {
  botId: string;
  name: string;
  description: string;
  riskLevel: BotProfileRiskLevel;
  supportedPairs: string[];
  strategyType: BotStrategyType;
  recommendedLeverage: number;
  tradeFrequency: BotTradeFrequency;
  aiConfidence?: number;
  tags?: string[];
};

export type BotProfileListSnapshot = {
  profiles: TradingBotProfile[];
  featured: TradingBotProfile[];
  updatedAt: string;
};
