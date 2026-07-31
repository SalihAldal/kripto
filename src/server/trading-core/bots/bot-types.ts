import type { MarketRegimeType, StrategyMode } from "@/src/server/trading-core/market-regime/market-regime.types";

export type BotStatus = "ACTIVE" | "PAUSED" | "DISABLED";

export type BotConfig = {
  id: string;
  name: string;
  strategy: string;
  priority: number;
  enabled: boolean;
  minScore: number;
  maxOpenPositions: number;
  allowedRegimes: MarketRegimeType[];
  preferredModes: StrategyMode[];
  cooldownMsAfterLoss: number;
};

export type BotMemoryState = {
  botId: string;
  status: BotStatus;
  lastSignalAt?: string;
  lastTradeAt?: string;
  cooldownUntil?: string;
  openSymbols: string[];
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  realizedPnl: number;
  unrealizedPnl: number;
  score: number;
  weight: number;
  disabledReason?: string;
};

export type BotAllocation = {
  botId: string;
  botName: string;
  strategy: string;
  priority: number;
  weight: number;
  score: number;
  reason: string;
};

export type BotPerformanceUpdate = {
  botId: string;
  realizedPnl: number;
  unrealizedPnl?: number;
  closed?: boolean;
  symbol?: string;
  strategy?: string;
  returnPercent?: number;
  openedAt?: string;
  closedAt?: string;
  durationMs?: number;
};
