export type MarketDataSource = "binance-ws" | "binance-rest-bootstrap" | "binance-rest-recovery" | "memory";

export type MarketTickerEvent = {
  type: "ticker";
  symbol: string;
  price: number;
  openPrice: number;
  high24h: number;
  low24h: number;
  quoteVolume: number;
  baseVolume: number;
  eventTime: number;
  receiveTime: number;
  source: MarketDataSource;
  sequence?: number;
};

export type MarketTradeEvent = {
  type: "trade";
  symbol: string;
  price: number;
  quantity: number;
  quoteNotional: number;
  eventTime: number;
  tradeTime: number;
  receiveTime: number;
  buyerMaker: boolean;
  takerSide: "BUY" | "SELL";
  aggregateId?: number;
  source: MarketDataSource;
};

export type MarketBookTickerEvent = {
  type: "bookTicker";
  symbol: string;
  bestBid: number;
  bestBidQty: number;
  bestAsk: number;
  bestAskQty: number;
  spreadAbsolute: number;
  spreadBps: number;
  eventTime: number;
  receiveTime: number;
  updateId?: number;
  source: MarketDataSource;
};

export type MarketCandleEvent = {
  type: "candle";
  symbol: string;
  interval: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  closed: boolean;
  eventTime: number;
  receiveTime: number;
  source: MarketDataSource;
};

export type MarketDepthDeltaEvent = {
  type: "depth";
  symbol: string;
  firstUpdateId: number;
  finalUpdateId: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  eventTime: number;
  receiveTime: number;
  source: MarketDataSource;
};

export type CanonicalMarketEvent =
  | MarketTickerEvent
  | MarketTradeEvent
  | MarketBookTickerEvent
  | MarketCandleEvent
  | MarketDepthDeltaEvent;

export type RollingWindowKey = "1s" | "5s" | "15s" | "30s" | "1m" | "3m" | "5m" | "15m";

export const ROLLING_WINDOW_MS: Record<RollingWindowKey, number> = {
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "30s": 30_000,
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
};

export type RollingMetrics = {
  return1s: number | null;
  return5s: number | null;
  return15s: number | null;
  return30s: number | null;
  return1m: number | null;
  return3m: number | null;
  return5m: number | null;
  return15m: number | null;
  volumeDelta: number | null;
  quoteVolumeDelta: number | null;
};

export type SymbolMarketSnapshot = {
  symbol: string;
  lastPrice: number;
  previousPrice: number;
  openPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  baseVolume24h: number;
  eventTime: number;
  localReceiveTime: number;
  lastUpdateAt: number;
  stale: boolean;
  rolling: RollingMetrics;
};

export type BookTickerState = {
  symbol: string;
  bestBid: number;
  bestBidQty: number;
  bestAsk: number;
  bestAskQty: number;
  spreadAbsolute: number;
  spreadBps: number;
  eventTime: number;
  lastUpdateAt: number;
  stale: boolean;
};

export type DeepMarketState = {
  symbol: string;
  bookTicker: BookTickerState | null;
  recentTrades: MarketTradeEvent[];
  klines1m: Array<{
    openTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  orderBookValid: boolean;
  orderBookGap: boolean;
};
