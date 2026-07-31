export type ExchangeEnvironment = "testnet" | "live";

export type FilterMap = Record<string, Record<string, string>>;

export type ExchangeSymbolInfo = {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: FilterMap;
};

export type ExchangeInfoResponse = {
  timezone: string;
  serverTime: number;
  symbols: ExchangeSymbolInfo[];
};

export type KlineItem = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type OrderBookLevel = {
  price: number;
  quantity: number;
};

export type OrderBookSnapshot = {
  lastUpdateId?: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};

export type RecentTrade = {
  id: number;
  price: number;
  qty: number;
  quoteQty?: number;
  time: number;
  isBuyerMaker?: boolean;
};

export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";

export type PlaceOrderRequest = {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  quoteOrderQty?: number;
  price?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
  dryRun?: boolean;
};

export type PlaceOrderResult = {
  orderId: string;
  clientOrderId?: string;
  symbol: string;
  status: string;
  side: OrderSide;
  type: OrderType;
  executedQty: number;
  price?: number;
  dryRun: boolean;
  metadata?: Record<string, unknown>;
};

export type SymbolValidationResult = {
  ok: boolean;
  reasons: string[];
  adjustedQuantity?: number;
  adjustedPrice?: number;
  minNotional?: number;
};

export type FeeEstimate = {
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  takerFeeRate: number;
  makerFeeRate: number;
  estimatedTakerFee: number;
  estimatedMakerFee: number;
};

export type ExchangeBalance = {
  asset: string;
  free: number;
  locked: number;
  total: number;
};

export type RetryOptions = {
  retries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
};
