export type TradingCoreTable =
  | "trades"
  | "positions"
  | "signals"
  | "bot_stats"
  | "risk_logs"
  | "ai_predictions"
  | "market_regimes";

export type TradingCoreEvent = {
  aggregateType: TradingCoreTable | "orders" | "bots" | "system";
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
};

export type WriteBufferItem = {
  table: TradingCoreTable;
  key: string;
  payload: Record<string, unknown>;
};

export type CacheOptions = {
  ttlSec: number;
  namespace?: string;
};

export type PubSubMessage = {
  type: string;
  payload: Record<string, unknown>;
  publishedAt: string;
};
