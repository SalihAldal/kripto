import type {
  CanonicalCandle,
  CanonicalFeeInfo,
  CanonicalFunding,
  CanonicalOpenInterest,
  CanonicalOrderbook,
  CanonicalOrderRequest,
  CanonicalOrderResponse,
  CanonicalPortfolioBalance,
  CanonicalTicker,
  CanonicalTradeData,
  ExchangeCapabilityMatrix,
  ExchangeHealthSnapshot,
  PrecisionRules,
} from "@/src/server/exchange-abstraction/exchange-abstraction.types";
import type { ExchangePluginType } from "@prisma/client";

export interface IUniversalExchangeAdapter {
  readonly pluginType: ExchangePluginType;
  readonly displayName: string;
  readonly isAvailable: boolean;

  connect(): Promise<{ connected: boolean; mode: string }>;
  disconnect(): Promise<{ disconnected: boolean }>;
  getSymbols(): Promise<Array<{ canonicalSymbol: string; exchangeSymbol: string; baseAsset: string; quoteAsset: string }>>;
  getTicker(canonicalSymbol: string): Promise<CanonicalTicker>;
  getOrderBook(canonicalSymbol: string, limit?: number): Promise<CanonicalOrderbook>;
  getCandles(canonicalSymbol: string, interval?: string, limit?: number): Promise<CanonicalCandle[]>;
  getBalance(): Promise<CanonicalPortfolioBalance[]>;
  getOpenOrders(canonicalSymbol?: string): Promise<CanonicalOrderResponse[]>;
  getTrades(canonicalSymbol: string, limit?: number): Promise<CanonicalTradeData[]>;
  placeOrder(order: CanonicalOrderRequest): Promise<CanonicalOrderResponse>;
  cancelOrder(canonicalSymbol: string, orderId: string): Promise<{ orderId: string; status: string }>;
  cancelAllOrders(canonicalSymbol?: string): Promise<{ canceled: number }>;
  getOrder(canonicalSymbol: string, orderId: string): Promise<CanonicalOrderResponse>;
  getFees(canonicalSymbol: string): Promise<CanonicalFeeInfo>;
  getExchangeInfo(): Promise<{ symbols: number; serverTime: number }>;
  getCapabilities(): ExchangeCapabilityMatrix;
  getPrecision(canonicalSymbol: string): Promise<PrecisionRules>;
  health(): Promise<ExchangeHealthSnapshot>;
  getFunding?(canonicalSymbol: string): Promise<CanonicalFunding>;
  getOpenInterest?(canonicalSymbol: string): Promise<CanonicalOpenInterest>;
}
