import { createHmac } from "node:crypto";
import { env } from "@/lib/config";
import { getExchangeProvider } from "@/src/server/exchange/provider-factory";
import type { ExchangeProvider } from "@/src/server/exchange/providers/base-provider";
import { mapBinanceAdapterError, normalizeOrderStatus } from "@/src/server/exchange/adapters/error-mapper";
import type {
  ExchangeAdapter,
  NormalizedOpenOrder,
  NormalizedOrderResponse,
  NormalizedSymbolRules,
  PlaceOrderAdapterInput,
} from "@/src/types/exchange-adapter";
import type { ExchangeSymbolInfo } from "@/src/types/exchange";

function countPrecision(step: number) {
  if (!Number.isFinite(step) || step <= 0) return 8;
  const asText = step.toString();
  if (!asText.includes(".")) return 0;
  return asText.split(".")[1]?.replace(/0+$/, "").length ?? 0;
}

function parseFilterNumber(symbol: ExchangeSymbolInfo, filterType: string, field: string, fallback = 0) {
  return Number(symbol.filters[filterType]?.[field] ?? fallback);
}

function normalizeRules(symbol: ExchangeSymbolInfo): NormalizedSymbolRules {
  const tickSize = parseFilterNumber(symbol, "PRICE_FILTER", "tickSize", 0.0001);
  const stepSize = parseFilterNumber(symbol, "LOT_SIZE", "stepSize", 0.0001);
  const minNotional = Number(
    symbol.filters.MIN_NOTIONAL?.minNotional ??
      symbol.filters.NOTIONAL?.minNotional ??
      symbol.filters.NOTIONAL?.notional ??
      0,
  );
  const minQty = parseFilterNumber(symbol, "LOT_SIZE", "minQty", 0);
  return {
    symbol: symbol.symbol.toUpperCase(),
    baseAsset: symbol.baseAsset.toUpperCase(),
    quoteAsset: symbol.quoteAsset.toUpperCase(),
    status: symbol.status === "TRADING" ? "ACTIVE" : "HALTED",
    tickSize,
    stepSize,
    minNotional,
    minQty,
    quantityPrecision: countPrecision(stepSize),
    pricePrecision: countPrecision(tickSize),
  };
}

export class BinanceTrExchangeAdapter implements ExchangeAdapter {
  constructor(private readonly provider: ExchangeProvider = getExchangeProvider()) {}

  private toNormalizedOrder(row: Record<string, unknown>, side: "BUY" | "SELL", type: "MARKET" | "LIMIT"): NormalizedOrderResponse {
    return {
      orderId: String(row.orderId ?? row.order_id ?? row.id ?? ""),
      symbol: String(row.symbol ?? "").toUpperCase(),
      side,
      type,
      status: normalizeOrderStatus(row.status),
      executedQty: Number(row.executedQty ?? row.executed_quantity ?? row.executedQuantity ?? 0),
      requestedQty: Number(row.origQty ?? row.quantity ?? 0) || undefined,
      price: Number(row.price ?? 0) || undefined,
      averagePrice: Number(row.avgPrice ?? row.avgExecutionPrice ?? 0) || undefined,
      raw: row,
    };
  }

  private sign(params: URLSearchParams) {
    return createHmac("sha256", env.BINANCE_API_SECRET ?? "").update(params.toString()).digest("hex");
  }

  private async fetchSigned(path: string, params: Record<string, string | number | undefined> = {}) {
    if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET) {
      throw new Error("code=-2015 missing api key/secret");
    }
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) search.set(key, String(value));
    }
    if (!search.has("timestamp")) search.set("timestamp", String(Date.now()));
    if (!search.has("recvWindow")) search.set("recvWindow", "5000");
    search.set("signature", this.sign(search));
    const url = `${env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "")}${path}?${search.toString()}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-MBX-APIKEY": env.BINANCE_API_KEY,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${body}`.trim());
    }
    const json = (await response.json()) as { code?: number; msg?: string; data?: unknown };
    if ((json.code ?? 0) !== 0) {
      throw new Error(`code=${json.code ?? "unknown"} ${json.msg ?? "unknown"}`);
    }
    return json.data ?? json;
  }

  async getBalances() {
    return this.provider.getAccountBalances();
  }

  async getMarketInfo(symbol: string) {
    const [ticker, orderBook] = await Promise.all([
      this.provider.getTicker(symbol),
      this.provider.getOrderBook(symbol, 20).catch(() => undefined),
    ]);
    return {
      symbol: ticker.symbol.toUpperCase(),
      lastPrice: ticker.price,
      change24h: ticker.change24h,
      volume24h: ticker.volume24h,
      orderBook,
    };
  }

  async getSymbolRules(symbol: string) {
    const info = await this.provider.getExchangeInfo();
    const matched = info.symbols.find((row) => row.symbol.toUpperCase() === symbol.toUpperCase());
    if (!matched) throw new Error(`Symbol not found: ${symbol}`);
    return normalizeRules(matched);
  }

  async listSymbolRules() {
    const info = await this.provider.getExchangeInfo();
    return info.symbols.map(normalizeRules);
  }

  async placeBuyOrder(input: PlaceOrderAdapterInput) {
    const normalizedSymbol = input.symbol.toUpperCase();
    if (input.type === "LIMIT") {
      if (!input.quantity || !input.price) throw new Error("validation: quantity and price required for limit buy");
      const row = await this.provider.placeLimitBuy(normalizedSymbol, input.quantity, input.price, input.dryRun);
      return this.toNormalizedOrder(row as unknown as Record<string, unknown>, "BUY", "LIMIT");
    }
    if (typeof input.quoteOrderQty === "number" && input.quoteOrderQty > 0 && this.provider.placeMarketBuyByQuote) {
      const row = await this.provider.placeMarketBuyByQuote(normalizedSymbol, input.quoteOrderQty, input.dryRun);
      return this.toNormalizedOrder(row as unknown as Record<string, unknown>, "BUY", "MARKET");
    }
    if (!input.quantity) throw new Error("validation: quantity required for market buy");
    const row = await this.provider.placeMarketBuy(normalizedSymbol, input.quantity, input.dryRun);
    return this.toNormalizedOrder(row as unknown as Record<string, unknown>, "BUY", "MARKET");
  }

  async placeSellOrder(input: PlaceOrderAdapterInput) {
    const normalizedSymbol = input.symbol.toUpperCase();
    if (!input.quantity) throw new Error("validation: quantity required for sell order");
    if (input.type === "LIMIT") {
      if (!input.price) throw new Error("validation: price required for limit sell");
      const row = await this.provider.placeLimitSell(normalizedSymbol, input.quantity, input.price, input.dryRun);
      return this.toNormalizedOrder(row as unknown as Record<string, unknown>, "SELL", "LIMIT");
    }
    const row = await this.provider.placeMarketSell(normalizedSymbol, input.quantity, input.dryRun);
    return this.toNormalizedOrder(row as unknown as Record<string, unknown>, "SELL", "MARKET");
  }

  async getOrderStatus(symbol: string, orderId: string) {
    const row = (await this.provider.getOrderStatus(symbol.toUpperCase(), orderId)) as Record<string, unknown>;
    const side = String(row.side ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
    const type = String(row.type ?? "MARKET").toUpperCase() === "LIMIT" ? "LIMIT" : "MARKET";
    return this.toNormalizedOrder(row, side, type);
  }

  async listOpenOrders(symbol?: string): Promise<NormalizedOpenOrder[]> {
    try {
      const payload = (await this.fetchSigned("/open/v1/orders", {
        symbol: symbol ? symbol.toUpperCase() : undefined,
      })) as unknown;
      const rows = Array.isArray(payload)
        ? payload
        : (payload as { list?: unknown[]; rows?: unknown[]; data?: unknown[] })?.list ??
          (payload as { list?: unknown[]; rows?: unknown[]; data?: unknown[] })?.rows ??
          (payload as { list?: unknown[]; rows?: unknown[]; data?: unknown[] })?.data ??
          [];
      return rows
        .filter((row) => row && typeof row === "object")
        .map((raw) => {
          const row = raw as Record<string, unknown>;
          const side = String(row.side ?? row.orderSide ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
          const type = String(row.type ?? row.orderType ?? "MARKET").toUpperCase() === "LIMIT" ? "LIMIT" : "MARKET";
          return {
            orderId: String(row.orderId ?? row.order_id ?? row.id ?? ""),
            symbol: String(row.symbol ?? "").replace(/_/g, "").toUpperCase(),
            side,
            type,
            status: normalizeOrderStatus(row.status),
            price: Number(row.price ?? 0) || undefined,
            quantity: Number(row.origQty ?? row.quantity ?? 0) || undefined,
            executedQty: Number(row.executedQty ?? row.executed_quantity ?? 0) || undefined,
            createdAt: row.time ? new Date(Number(row.time)).toISOString() : undefined,
            raw: row,
          } as NormalizedOpenOrder;
        });
    } catch (error) {
      throw new Error(this.mapError(error).message);
    }
  }

  async listOpenOrdersViaProvider(symbol?: string): Promise<NormalizedOpenOrder[]> {
    return this.listOpenOrders(symbol);
  }

  async cancelOrder(symbol: string, orderId: string) {
    const row = await this.provider.cancelOrder(symbol.toUpperCase(), orderId);
    return {
      ...row,
      status: normalizeOrderStatus(row.status),
    };
  }

  async normalizeFiltersAndPrecision(symbol: string, quantity: number, price?: number) {
    const [rules, validation] = await Promise.all([
      this.getSymbolRules(symbol),
      this.provider.validateSymbolFilters(symbol.toUpperCase(), quantity, price),
    ]);
    return {
      rules,
      normalizedQuantity: Number(validation.adjustedQuantity ?? quantity),
      normalizedPrice: validation.adjustedPrice,
      minNotional: Number(validation.minNotional ?? rules.minNotional),
      validationPassed: validation.ok,
      reasons: validation.reasons,
    };
  }

  async estimateFees(symbol: string, side: "BUY" | "SELL", quantity: number, price: number) {
    return this.provider.estimateFees(symbol.toUpperCase(), side, quantity, price);
  }

  mapError(error: unknown) {
    return mapBinanceAdapterError(error);
  }
}
