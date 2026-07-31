import type { BotMemoryState } from "@/src/server/trading-core/bots/bot-types";
import type { TradingRuntimeConfig } from "@/src/server/trading-core/config";
import type { ManagedPosition } from "@/src/server/trading-core/executors/position-types";

export type TenantStatus = "ACTIVE" | "STOPPED" | "PAUSED" | "ERROR";

export type TenantContext = {
  tenantId: string;
  userId: string;
  sessionId: string;
  status: TenantStatus;
  symbols: string[];
  startedAt: string;
  updatedAt: string;
};

export type TenantPortfolioSnapshot = {
  userId: string;
  balances: Record<string, number>;
  positions: ManagedPosition[];
  realizedPnl: number;
  unrealizedPnl: number;
  updatedAt: string;
};

export type TenantRuntimeSnapshot = {
  context: TenantContext;
  config: TradingRuntimeConfig;
  portfolio: TenantPortfolioSnapshot;
  bots: BotMemoryState[];
  stream: {
    enabled: boolean;
    status: string;
    symbols: string[];
    lastError?: string | null;
  };
};
