import type { BotPerformanceMetrics } from "@/src/server/trading-core/bots/bot-performance-types";
import type { MarketRegimeDecision } from "@/src/server/trading-core/market-regime";

export type AdaptiveMarketType = "TREND" | "CHOP" | "HIGH_VOLATILITY" | "LOW_VOLATILITY" | "MANIPULATION" | "NEWS_DRIVEN";
export type AdaptiveSwitchAction = "ACTIVATE" | "PAUSE" | "COOLDOWN" | "KEEP";

export type AdaptiveSwitchingInput = {
  symbol: string;
  marketRegime: MarketRegimeDecision;
  apply?: boolean;
  cooldownMs?: number;
  minRegimeConfidence?: number;
  disablePoorStrategies?: boolean;
};

export type AdaptiveBotDecision = {
  botId: string;
  botName: string;
  strategy: string;
  action: AdaptiveSwitchAction;
  enabled: boolean;
  reason: string;
  metrics: BotPerformanceMetrics;
};

export type AdaptiveSwitchingPlan = {
  symbol: string;
  marketType: AdaptiveMarketType;
  regimeConfidenceScore: number;
  activeBots: string[];
  pausedBots: string[];
  cooldownStrategies: string[];
  botDecisions: AdaptiveBotDecision[];
  applied: boolean;
  reasons: string[];
  generatedAt: string;
};
