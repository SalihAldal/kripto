import { getExchangeProvider } from "@/src/server/exchange/provider-factory";
import { getExchangeAdapter } from "@/src/server/exchange/adapter-factory";
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
import { normalizeToCanonical, toCanonicalSymbol, toExchangeSymbol } from "@/src/server/exchange-abstraction/symbol-normalization.service";
import { buildPrecisionRules, normalizePrice, normalizeQuantity } from "@/src/server/exchange-abstraction/precision-layer.service";
import { fromExchangeOrder, toCanonicalBalances, toExchangeOrderInput } from "@/src/server/exchange-abstraction/order-translator.service";
import { normalizeFeeEstimate } from "@/src/server/exchange-abstraction/fee-engine.service";

export class BinanceSpotAdapter implements IUniversalExchangeAdapter {
  readonly pluginType = "BINANCE_SPOT" as const;
  readonly displayName = "Binance Spot";
  readonly isAvailable = true;

  private connected = false;
  private readonly provider = getExchangeProvider();
  private readonly adapter = getExchangeAdapter();

  async connect() {
    await this.provider.getExchangeInfo().catch(() => null);
    this.connected = true;
    return { connected: true, mode: "REST+WS" };
  }

  async disconnect() {
    this.connected = false;
    return { disconnected: true };
  }

  async getSymbols() {
    const info = await this.provider.getExchangeInfo();
    return info.symbols
      .filter((s) => s.status === "TRADING")
      .map((s) => ({
        canonicalSymbol: toCanonicalSymbol(s.baseAsset, s.quoteAsset),
        exchangeSymbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
      }));
  }

  async getTicker(canonicalSymbol: string): Promise<CanonicalTicker> {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const t = await this.provider.getTicker(symbol);
    return {
      canonicalSymbol: normalizeToCanonical(canonicalSymbol),
      lastPrice: t.price,
      change24h: t.change24h,
      volume24h: t.volume24h,
      timestamp: Date.now(),
    };
  }

  async getOrderBook(canonicalSymbol: string, limit = 20): Promise<CanonicalOrderbook> {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const book = await this.provider.getOrderBook(symbol, limit);
    return {
      canonicalSymbol: normalizeToCanonical(canonicalSymbol),
      bids: book.bids,
      asks: book.asks,
      lastUpdateId: book.lastUpdateId,
      timestamp: Date.now(),
    };
  }

  async getCandles(canonicalSymbol: string, interval = "1m", limit = 100): Promise<CanonicalCandle[]> {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const klines = await this.provider.getKlines(symbol, interval, limit);
    const canonical = normalizeToCanonical(canonicalSymbol);
    return klines.map((k) => ({
      canonicalSymbol: canonical,
      openTime: k.openTime,
      closeTime: k.closeTime,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
  }

  async getBalance(): Promise<CanonicalPortfolioBalance[]> {
    const balances = await this.provider.getAccountBalances();
    return toCanonicalBalances(balances);
  }

  async getOpenOrders(canonicalSymbol?: string): Promise<CanonicalOrderResponse[]> {
    const symbol = canonicalSymbol ? toExchangeSymbol(canonicalSymbol) : undefined;
    const orders = await this.adapter.listOpenOrders(symbol);
    return orders.map((o) =>
      fromExchangeOrder(
        {
          orderId: o.orderId,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          status: o.status,
          executedQty: o.executedQty ?? 0,
          requestedQty: o.quantity,
          price: o.price,
        },
        normalizeToCanonical(o.symbol),
      ),
    );
  }

  async getTrades(canonicalSymbol: string, limit = 50): Promise<CanonicalTradeData[]> {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const trades = await this.provider.getRecentTrades(symbol, limit);
    const canonical = normalizeToCanonical(canonicalSymbol);
    return trades.map((t) => ({
      canonicalSymbol: canonical,
      tradeId: String(t.id),
      price: t.price,
      quantity: t.qty,
      quoteQty: t.quoteQty,
      side: t.isBuyerMaker ? "SELL" : "BUY",
      isMaker: t.isBuyerMaker,
      timestamp: t.time,
    }));
  }

  async placeOrder(order: CanonicalOrderRequest): Promise<CanonicalOrderResponse> {
    const input = toExchangeOrderInput(order);
    const canonical = normalizeToCanonical(order.canonicalSymbol);
    let result;
    if (order.side === "BUY") {
      result = input.quoteOrderQty
        ? await this.adapter.placeBuyOrder({ ...input, quoteOrderQty: input.quoteOrderQty })
        : await this.adapter.placeBuyOrder({ ...input, quantity: input.quantity ?? 0 });
    } else {
      result = await this.adapter.placeSellOrder({ ...input, quantity: input.quantity ?? 0 });
    }
    return fromExchangeOrder({ ...result, dryRun: order.dryRun }, canonical);
  }

  async cancelOrder(canonicalSymbol: string, orderId: string) {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const result = await this.adapter.cancelOrder(symbol, orderId);
    return { orderId: result.orderId, status: result.status };
  }

  async cancelAllOrders(canonicalSymbol?: string) {
    const orders = await this.getOpenOrders(canonicalSymbol);
    let canceled = 0;
    for (const order of orders) {
      await this.cancelOrder(order.canonicalSymbol, order.orderId).catch(() => null);
      canceled++;
    }
    return { canceled };
  }

  async getOrder(canonicalSymbol: string, orderId: string): Promise<CanonicalOrderResponse> {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const result = await this.adapter.getOrderStatus(symbol, orderId);
    return fromExchangeOrder(result, normalizeToCanonical(canonicalSymbol));
  }

  async getFees(canonicalSymbol: string): Promise<CanonicalFeeInfo> {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const ticker = await this.provider.getTicker(symbol);
    const estimate = await this.adapter.estimateFees(symbol, "BUY", 1, ticker.price);
    return normalizeFeeEstimate(normalizeToCanonical(canonicalSymbol), estimate, { bnbDiscount: 0.25 });
  }

  async getExchangeInfo() {
    const info = await this.provider.getExchangeInfo();
    return { symbols: info.symbols.length, serverTime: info.serverTime };
  }

  getCapabilities(): ExchangeCapabilityMatrix {
    return {
      spot: true,
      margin: false,
      futures: false,
      options: false,
      funding: false,
      openInterest: false,
      orderbook: true,
      websocket: true,
      historicalData: true,
      rateLimitPerMin: 1200,
      pricePrecision: 8,
      qtyPrecision: 8,
    };
  }

  async getPrecision(canonicalSymbol: string): Promise<PrecisionRules> {
    const symbol = toExchangeSymbol(canonicalSymbol);
    const rules = await this.adapter.getSymbolRules(symbol);
    return buildPrecisionRules({
      canonicalSymbol: normalizeToCanonical(canonicalSymbol),
      tickSize: rules.tickSize,
      stepSize: rules.stepSize,
      minNotional: rules.minNotional,
      minQty: rules.minQty,
    });
  }

  async health(): Promise<ExchangeHealthSnapshot> {
    const runtime = this.provider.getRuntimeStatus();
    const endpoints = this.provider.getPublicEndpointHealth();
    const avgLatency = endpoints.length > 0
      ? endpoints.reduce((s, e) => s + e.latencyEwmaMs, 0) / endpoints.length
      : 0;
    const failures = endpoints.reduce((s, e) => s + e.failures, 0);
    return {
      availability: runtime.globalBanActive || runtime.networkCooldownActive ? 50 : 99,
      latencyMs: avgLatency,
      apiErrorCount: failures,
      rateLimitHits: runtime.globalBanActive ? 1 : 0,
      wsStability: this.connected ? 95 : 70,
      dataFreshness: 90,
      syncStatus: runtime.fallbackActive ? "DEGRADED" : "OK",
      restConnected: !runtime.networkCooldownActive,
      wsConnected: this.connected,
    };
  }

  normalizeOrderPrice(canonicalSymbol: string, price: number) {
    return this.getPrecision(canonicalSymbol).then((rules) => normalizePrice(price, rules));
  }

  normalizeOrderQuantity(canonicalSymbol: string, quantity: number) {
    return this.getPrecision(canonicalSymbol).then((rules) => normalizeQuantity(quantity, rules));
  }
}
