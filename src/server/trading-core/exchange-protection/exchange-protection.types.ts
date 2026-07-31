export type ExchangeRequestPriority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export type ExchangeRequestKind = "ORDER" | "CANCEL" | "ACCOUNT" | "MARKET_DATA" | "SYSTEM";

export type ProtectedExchangeRequest = {
  id?: string;
  exchange: "binance-futures" | "binance-spot" | "binance";
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  init?: RequestInit;
  weight: number;
  priority: ExchangeRequestPriority;
  kind: ExchangeRequestKind;
  useWebSocketFallback?: boolean;
  createdAt?: string;
};

export type ExchangeWeightSnapshot = {
  usedWeight1m: number;
  usedOrderCount1m: number;
  maxWeight1m: number;
  maxOrderCount1m: number;
  adaptiveDelayMs: number;
  blockedUntil: string | null;
  updatedAt: string;
};

export type ExchangeQueueSnapshot = {
  depth: number;
  running: boolean;
  inFlight: number;
  processed: number;
  failed: number;
  byPriority: Record<ExchangeRequestPriority, number>;
};

export type ExchangeProtectionSnapshot = {
  weight: ExchangeWeightSnapshot;
  queue: ExchangeQueueSnapshot;
  recentErrors: string[];
  websocketFallbacks: number;
  updatedAt: string;
};
