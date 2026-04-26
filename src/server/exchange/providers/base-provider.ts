import type {
  ExchangeEnvironment,
  ExchangeInfoResponse,
  ExchangeBalance,
  FeeEstimate,
  KlineItem,
  OrderBookSnapshot,
  PlaceOrderResult,
  RecentTrade,
  SymbolValidationResult,
} from "@/src/types/exchange";

export interface ExchangeProvider {
  readonly name: string;
  readonly environment: ExchangeEnvironment;
  readonly dryRun: boolean;

  getTicker(symbol: string): Promise<{ symbol: string; price: number; change24h: number; volume24h: number }>;
  getKlines(symbol: string, interval?: string, limit?: number): Promise<KlineItem[]>;
  getOrderBook(symbol: string, limit?: number): Promise<OrderBookSnapshot>;
  getRecentTrades(symbol: string, limit?: number): Promise<RecentTrade[]>;
  placeMarketBuy(symbol: string, quantity: number, dryRun?: boolean): Promise<PlaceOrderResult>;
  placeMarketBuyByQuote?(symbol: string, quoteOrderQty: number, dryRun?: boolean): Promise<PlaceOrderResult>;
  placeMarketSell(symbol: string, quantity: number, dryRun?: boolean): Promise<PlaceOrderResult>;
  placeLimitBuy(symbol: string, quantity: number, price: number, dryRun?: boolean): Promise<PlaceOrderResult>;
  placeLimitSell(symbol: string, quantity: number, price: number, dryRun?: boolean): Promise<PlaceOrderResult>;
  cancelOrder(symbol: string, orderId: string): Promise<{ symbol: string; orderId: string; status: string }>;
  getOrderStatus(symbol: string, orderId: string): Promise<Record<string, unknown>>;
  getExchangeInfo(): Promise<ExchangeInfoResponse>;
  validateSymbolFilters(symbol: string, quantity: number, price?: number): Promise<SymbolValidationResult>;
  calculateValidQuantity(symbol: string, quantity: number): Promise<number>;
  estimateFees(symbol: string, side: "BUY" | "SELL", quantity: number, price: number): Promise<FeeEstimate>;
  getAccountBalances(): Promise<ExchangeBalance[]>;
  subscribeTicker(symbol: string, onData: (data: { symbol: string; price: number; eventTime: number }) => void): () => void;
  getPublicEndpointHealth(): Array<{
    base: string;
    score: number;
    totalCalls: number;
    successes: number;
    failures: number;
    consecutiveFailures: number;
    latencyEwmaMs: number;
    lastLatencyMs: number;
    latencySamples: number[];
    cooldownUntil: string | null;
  }>;
  getRuntimeStatus(): {
    fallbackActive: boolean;
    globalBanActive: boolean;
    networkCooldownActive: boolean;
    globalBanUntil: string | null;
    networkCooldownUntil: string | null;
  };
}
