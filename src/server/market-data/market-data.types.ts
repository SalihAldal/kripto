import type { ExchangeInfoResponse, KlineItem, OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";

export type MarketDataPriority = "critical" | "high" | "normal" | "low" | "ui";

export type MarketDataKind =
  | "ticker"
  | "klines"
  | "orderBook"
  | "recentTrades"
  | "exchangeInfo"
  | "contextBundle";

export type MarketDataReadOptions = {
  priority?: MarketDataPriority;
  maxAgeMs?: number;
  allowStaleOnBackoff?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Explicit REST bootstrap/recovery only. Hot-path must omit this. */
  recovery?: boolean;
  /** Execution venue REST only: no untagged snapshot cache or stale/synthetic fallback. */
  strictExecution?: boolean;
};

export type MarketDataTicker = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  updatedAt: string;
};

export type MarketContextBundle = {
  symbol: string;
  ticker: MarketDataTicker;
  klines1m: KlineItem[];
  orderBook: OrderBookSnapshot | null;
  recentTrades: RecentTrade[] | null;
  klines1h: KlineItem[];
};

export type MarketDataTelemetry = {
  totalRequests: number;
  cacheHits: number;
  coalescedHits: number;
  duplicateAvoided: number;
  exchangeCalls: number;
  estimatedWeight: number;
  rateLimited429: number;
  backoffActive: boolean;
  backoffUntil: number | null;
  cacheHitRatio: number;
  averageLatencyMs: number;
  requestsByKind: Record<string, number>;
};

export type MarketDataValidationSnapshot = MarketDataTelemetry & {
  exchangeInfoCalls: number;
};

export type ExchangeInfoCache = ExchangeInfoResponse;
