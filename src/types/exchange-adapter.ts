import type { ExchangeBalance, FeeEstimate, OrderBookSnapshot } from "@/src/types/exchange";

export type NormalizedOrderStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "SIMULATED"
  | "UNKNOWN";

export type NormalizedSymbolRules = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: "ACTIVE" | "HALTED";
  tickSize: number;
  stepSize: number;
  minNotional: number;
  minQty: number;
  quantityPrecision: number;
  pricePrecision: number;
};

export type NormalizedOrderResponse = {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  status: NormalizedOrderStatus;
  executedQty: number;
  requestedQty?: number;
  price?: number;
  averagePrice?: number;
  raw?: Record<string, unknown>;
};

export type NormalizedOpenOrder = {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  status: NormalizedOrderStatus;
  price?: number;
  quantity?: number;
  executedQty?: number;
  createdAt?: string;
  raw?: Record<string, unknown>;
};

export type NormalizedMarketInfo = {
  symbol: string;
  lastPrice: number;
  change24h: number;
  volume24h: number;
  orderBook?: OrderBookSnapshot;
};

export type ExchangeAdapterError = {
  code:
    | "AUTH_INVALID"
    | "PERMISSION_DENIED"
    | "MIN_NOTIONAL"
    | "MIN_QTY"
    | "SYMBOL_HALTED"
    | "RATE_LIMIT"
    | "NETWORK"
    | "VALIDATION"
    | "UNKNOWN";
  message: string;
  retryable: boolean;
  providerCode?: string;
  providerMessage?: string;
  raw?: unknown;
};

export type PlaceOrderAdapterInput = {
  symbol: string;
  quantity?: number;
  quoteOrderQty?: number;
  type: "MARKET" | "LIMIT";
  price?: number;
  dryRun?: boolean;
};

export type ExchangeAdapter = {
  getBalances(): Promise<ExchangeBalance[]>;
  getMarketInfo(symbol: string): Promise<NormalizedMarketInfo>;
  getSymbolRules(symbol: string): Promise<NormalizedSymbolRules>;
  listSymbolRules(): Promise<NormalizedSymbolRules[]>;
  placeBuyOrder(input: PlaceOrderAdapterInput): Promise<NormalizedOrderResponse>;
  placeSellOrder(input: PlaceOrderAdapterInput): Promise<NormalizedOrderResponse>;
  getOrderStatus(symbol: string, orderId: string): Promise<NormalizedOrderResponse>;
  listOpenOrders(symbol?: string): Promise<NormalizedOpenOrder[]>;
  cancelOrder(symbol: string, orderId: string): Promise<{ symbol: string; orderId: string; status: NormalizedOrderStatus }>;
  normalizeFiltersAndPrecision(symbol: string, quantity: number, price?: number): Promise<{
    rules: NormalizedSymbolRules;
    normalizedQuantity: number;
    normalizedPrice?: number;
    minNotional: number;
    validationPassed: boolean;
    reasons: string[];
  }>;
  estimateFees(symbol: string, side: "BUY" | "SELL", quantity: number, price: number): Promise<FeeEstimate>;
  mapError(error: unknown): ExchangeAdapterError;
};
