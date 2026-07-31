import type {
  CanonicalOrderSide,
  CanonicalOrderStatusEnum,
  CanonicalOrderType,
  ExchangeAbstractionJobType,
  ExchangeConnectionMode,
  ExchangePluginType,
} from "@prisma/client";

export type ExchangeAbstractionJobPayload =
  | { type: "HEALTH_CHECK"; pluginType?: ExchangePluginType }
  | { type: "SYMBOL_SYNC"; pluginType?: ExchangePluginType }
  | { type: "BALANCE_SYNC"; pluginType?: ExchangePluginType }
  | { type: "CONNECTION_MONITOR"; pluginType?: ExchangePluginType }
  | { type: "RATE_LIMIT_SYNC"; pluginType?: ExchangePluginType }
  | { type: "RECONNECT"; pluginType?: ExchangePluginType }
  | { type: "LATENCY_PROBE"; pluginType?: ExchangePluginType };

export type CanonicalTicker = {
  canonicalSymbol: string;
  lastPrice: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
};

export type CanonicalCandle = {
  canonicalSymbol: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CanonicalOrderbook = {
  canonicalSymbol: string;
  bids: Array<{ price: number; quantity: number }>;
  asks: Array<{ price: number; quantity: number }>;
  lastUpdateId?: number;
  timestamp: number;
};

export type CanonicalTradeData = {
  canonicalSymbol: string;
  tradeId: string;
  price: number;
  quantity: number;
  quoteQty?: number;
  side: CanonicalOrderSide;
  isMaker?: boolean;
  timestamp: number;
};

export type CanonicalFunding = {
  canonicalSymbol: string;
  fundingRate: number;
  nextFundingTime?: number;
  timestamp: number;
};

export type CanonicalOpenInterest = {
  canonicalSymbol: string;
  openInterest: number;
  timestamp: number;
};

export type CanonicalPortfolioBalance = {
  asset: string;
  free: number;
  locked: number;
  total: number;
};

export type CanonicalOrderRequest = {
  canonicalSymbol: string;
  side: CanonicalOrderSide;
  type: CanonicalOrderType;
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  dryRun?: boolean;
};

export type CanonicalOrderResponse = {
  orderId: string;
  canonicalSymbol: string;
  side: CanonicalOrderSide;
  type: CanonicalOrderType;
  status: CanonicalOrderStatusEnum;
  quantity: number;
  executedQty: number;
  price?: number;
  averagePrice?: number;
  dryRun: boolean;
};

export type CanonicalFeeInfo = {
  canonicalSymbol: string;
  makerFeeRate: number;
  takerFeeRate: number;
  withdrawalFee?: number;
  depositFee?: number;
  bnbDiscount?: number;
};

export type PrecisionRules = {
  canonicalSymbol: string;
  pricePrecision: number;
  quantityPrecision: number;
  tickSize: number;
  stepSize: number;
  minNotional: number;
  minQty: number;
  maxQty?: number;
};

export type ExchangeCapabilityMatrix = {
  spot: boolean;
  margin: boolean;
  futures: boolean;
  options: boolean;
  funding: boolean;
  openInterest: boolean;
  orderbook: boolean;
  websocket: boolean;
  historicalData: boolean;
  rateLimitPerMin: number;
  pricePrecision: number;
  qtyPrecision: number;
};

export type ExchangeHealthSnapshot = {
  availability: number;
  latencyMs: number;
  apiErrorCount: number;
  rateLimitHits: number;
  wsStability: number;
  dataFreshness: number;
  syncStatus: string;
  restConnected: boolean;
  wsConnected: boolean;
};

export const SUPPORTED_PLUGINS: ExchangePluginType[] = [
  "BINANCE_SPOT", "BINANCE_FUTURES", "BYBIT", "OKX", "GATE", "MEXC", "KUCOIN", "KRAKEN", "COINBASE",
];

export const EXCHANGE_EVENT = {
  CONNECTED: "ExchangeConnected",
  DISCONNECTED: "ExchangeDisconnected",
  HEALTH_UPDATED: "ExchangeHealthUpdated",
  SYMBOLS_SYNCED: "SymbolsSynced",
  BALANCES_SYNCED: "BalancesSynced",
  ORDER_PLACED: "CanonicalOrderPlaced",
  ORDER_CANCELED: "CanonicalOrderCanceled",
  RATE_LIMIT_HIT: "RateLimitHit",
  RECONNECTED: "ExchangeReconnected",
  LATENCY_RECORDED: "LatencyRecorded",
} as const;

export type { ExchangeAbstractionJobType, ExchangeConnectionMode, ExchangePluginType };
