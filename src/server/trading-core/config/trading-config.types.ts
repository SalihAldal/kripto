export type TradingRiskLevel = "LOW" | "MID" | "HIGH";

export type StrategyRuntimeConfig = {
  enabled: boolean;
  minScore: number;
  params: Record<string, number | string | boolean>;
};

export type BotRuntimeConfig = {
  enabled: boolean;
  minScore: number;
  maxOpenPositions: number;
  cooldownMsAfterLoss: number;
};

export type UserTradingConfig = {
  leverage?: number;
  riskLevel?: TradingRiskLevel;
  maxDailyLossPercent?: number;
  maxOpenPositions?: number;
  coinWhitelist?: string[];
};

export type TradingRuntimeConfig = {
  leverage: number;
  riskLevel: TradingRiskLevel;
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  maxOpenPositions: number;
  minLiquidationDistancePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingActivationPercent: number;
  trailingDistancePercent: number;
  autoBreakevenActivationPercent: number;
  partialTakeProfitPercent: number;
  partialTakeProfitQuantityPercent: number;
  aiConfidenceThreshold: number;
  aiTimeoutMs: number;
  aiServiceUrl: string;
  coinWhitelist: string[];
  cooldownMsAfterDeny: number;
  strategy: Record<string, StrategyRuntimeConfig>;
  bots: Record<string, BotRuntimeConfig>;
  users: Record<string, UserTradingConfig>;
};

export type TradingConfigScope = "global" | "strategy" | "bot" | "user";

export type TradingConfigRecord = {
  scope: TradingConfigScope;
  key: string;
  value: unknown;
  source: "env" | "runtime";
  updatedAt: string;
};
