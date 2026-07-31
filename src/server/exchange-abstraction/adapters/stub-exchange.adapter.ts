import type { IUniversalExchangeAdapter } from "@/src/server/exchange-abstraction/exchange-interface";
import type {
  CanonicalCandle,
  CanonicalFeeInfo,
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

function notAvailable(method: string): never {
  throw new Error(`${method} not available — adapter not yet implemented`);
}

export class StubExchangeAdapter implements IUniversalExchangeAdapter {
  readonly isAvailable = false;

  constructor(
    readonly pluginType: ExchangePluginType,
    readonly displayName: string,
    private readonly caps: Partial<ExchangeCapabilityMatrix> = {},
  ) {}

  async connect() { return { connected: false, mode: "UNAVAILABLE" }; }
  async disconnect() { return { disconnected: true }; }
  async getSymbols() { return []; }
  async getTicker(_s: string): Promise<CanonicalTicker> { notAvailable("getTicker"); }
  async getOrderBook(_s: string, _l?: number): Promise<CanonicalOrderbook> { notAvailable("getOrderBook"); }
  async getCandles(_s: string, _i?: string, _l?: number): Promise<CanonicalCandle[]> { notAvailable("getCandles"); }
  async getBalance(): Promise<CanonicalPortfolioBalance[]> { return []; }
  async getOpenOrders(_s?: string): Promise<CanonicalOrderResponse[]> { return []; }
  async getTrades(_s: string, _l?: number): Promise<CanonicalTradeData[]> { return []; }
  async placeOrder(_o: CanonicalOrderRequest): Promise<CanonicalOrderResponse> { notAvailable("placeOrder"); }
  async cancelOrder(_s: string, _id: string): Promise<{ orderId: string; status: string }> { notAvailable("cancelOrder"); }
  async cancelAllOrders(_s?: string) { return { canceled: 0 }; }
  async getOrder(_s: string, _id: string): Promise<CanonicalOrderResponse> { notAvailable("getOrder"); }
  async getFees(_s: string): Promise<CanonicalFeeInfo> { notAvailable("getFees"); }
  async getExchangeInfo() { return { symbols: 0, serverTime: Date.now() }; }

  getCapabilities(): ExchangeCapabilityMatrix {
    return {
      spot: this.caps.spot ?? false,
      margin: this.caps.margin ?? false,
      futures: this.caps.futures ?? false,
      options: this.caps.options ?? false,
      funding: this.caps.funding ?? false,
      openInterest: this.caps.openInterest ?? false,
      orderbook: this.caps.orderbook ?? false,
      websocket: this.caps.websocket ?? false,
      historicalData: this.caps.historicalData ?? false,
      rateLimitPerMin: this.caps.rateLimitPerMin ?? 600,
      pricePrecision: this.caps.pricePrecision ?? 8,
      qtyPrecision: this.caps.qtyPrecision ?? 8,
    };
  }

  async getPrecision(_s: string): Promise<PrecisionRules> { notAvailable("getPrecision"); }

  async health(): Promise<ExchangeHealthSnapshot> {
    return {
      availability: 0,
      latencyMs: 0,
      apiErrorCount: 0,
      rateLimitHits: 0,
      wsStability: 0,
      dataFreshness: 0,
      syncStatus: "UNAVAILABLE",
      restConnected: false,
      wsConnected: false,
    };
  }
}

export const BinanceFuturesAdapter = () =>
  new StubExchangeAdapter("BINANCE_FUTURES", "Binance Futures", { futures: true, funding: true, openInterest: true, websocket: true });
export const BybitAdapter = () =>
  new StubExchangeAdapter("BYBIT", "Bybit", { spot: true, futures: true, funding: true, openInterest: true });
export const OkxAdapter = () =>
  new StubExchangeAdapter("OKX", "OKX", { spot: true, futures: true, options: true, funding: true });
export const GateAdapter = () =>
  new StubExchangeAdapter("GATE", "Gate.io", { spot: true, futures: true });
export const MexcAdapter = () =>
  new StubExchangeAdapter("MEXC", "MEXC", { spot: true, futures: true });
export const KucoinAdapter = () =>
  new StubExchangeAdapter("KUCOIN", "KuCoin", { spot: true, futures: true });
export const KrakenAdapter = () =>
  new StubExchangeAdapter("KRAKEN", "Kraken", { spot: true, margin: true, futures: true });
export const CoinbaseAdapter = () =>
  new StubExchangeAdapter("COINBASE", "Coinbase", { spot: true });
