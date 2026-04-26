import { createHmac, randomUUID } from "node:crypto";
import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import type {
  ExchangeBalance,
  ExchangeEnvironment,
  ExchangeInfoResponse,
  ExchangeSymbolInfo,
  FeeEstimate,
  KlineItem,
  OrderBookSnapshot,
  PlaceOrderRequest,
  PlaceOrderResult,
  RecentTrade,
  SymbolValidationResult,
} from "@/src/types/exchange";
import type { ExchangeProvider } from "@/src/server/exchange/providers/base-provider";

type OkxApiResponse<T> = { code?: string; msg?: string; data?: T };
type Health = {
  totalCalls: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  latencyEwmaMs: number;
  lastLatencyMs: number;
  latencySamples: number[];
  cooldownUntil: number;
};

export class OkxExchangeProvider implements ExchangeProvider {
  public readonly name = "okx";
  public readonly environment: ExchangeEnvironment;
  public readonly dryRun: boolean;

  private readonly apiBase = "https://www.okx.com";
  private readonly timeoutMs = env.OKX_TIMEOUT_MS;
  private readonly key = env.OKX_API_KEY;
  private readonly secret = env.OKX_API_SECRET;
  private readonly passphrase = env.OKX_API_PASSPHRASE;
  private cachedExchangeInfo: ExchangeInfoResponse | null = null;
  private cacheAt = 0;
  private readonly health: Health = {
    totalCalls: 0,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    latencyEwmaMs: 0,
    lastLatencyMs: 0,
    latencySamples: [],
    cooldownUntil: 0,
  };

  constructor() {
    this.environment = env.OKX_ENV === "testnet" ? "testnet" : "live";
    this.dryRun = env.OKX_DRY_RUN;
    logger.info(
      {
        provider: this.name,
        environment: this.environment,
        dryRun: this.dryRun,
        hasAuth: Boolean(this.key && this.secret && this.passphrase),
      },
      "OKX provider initialized",
    );
  }

  private toInstId(symbol: string) {
    const upper = symbol.toUpperCase().replace(/[_-]/g, "");
    const quotes = ["USDT", "USDC", "BTC", "ETH", "TRY", "EUR"];
    const quote = quotes.find((q) => upper.endsWith(q)) ?? "USDT";
    const base = upper.slice(0, upper.length - quote.length);
    return `${base}-${quote}`;
  }

  private fromInstId(instId: string) {
    return instId.replace(/-/g, "").toUpperCase();
  }

  private intervalToBar(interval: string) {
    const key = interval.toLowerCase();
    if (key === "1m") return "1m";
    if (key === "3m") return "3m";
    if (key === "5m") return "5m";
    if (key === "15m") return "15m";
    if (key === "1h") return "1H";
    return "1m";
  }

  private signedHeaders(method: "GET" | "POST", pathWithQuery: string, body = "") {
    if (!this.key || !this.secret || !this.passphrase) return {};
    const ts = new Date().toISOString();
    const prehash = `${ts}${method}${pathWithQuery}${body}`;
    const sign = createHmac("sha256", this.secret).update(prehash).digest("base64");
    const headers: Record<string, string> = {
      "OK-ACCESS-KEY": this.key,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": this.passphrase,
    };
    if (this.environment === "testnet") headers["x-simulated-trading"] = "1";
    return headers;
  }

  private markSuccess(ms: number) {
    this.health.totalCalls += 1;
    this.health.successes += 1;
    this.health.consecutiveFailures = 0;
    this.health.lastLatencyMs = ms;
    this.health.latencyEwmaMs = this.health.latencyEwmaMs <= 0 ? ms : this.health.latencyEwmaMs * 0.7 + ms * 0.3;
    this.health.latencySamples = [...this.health.latencySamples, ms].slice(-10);
  }

  private markFailure(ms: number) {
    this.health.totalCalls += 1;
    this.health.failures += 1;
    this.health.consecutiveFailures += 1;
    this.health.lastLatencyMs = ms;
    this.health.latencyEwmaMs = this.health.latencyEwmaMs <= 0 ? ms : this.health.latencyEwmaMs * 0.8 + ms * 0.2;
    this.health.latencySamples = [...this.health.latencySamples, ms].slice(-10);
    this.health.cooldownUntil = Date.now() + Math.min(2 ** this.health.consecutiveFailures, 16) * 1000;
  }

  private async request<T>(method: "GET" | "POST", path: string, query?: Record<string, string | number | undefined>, bodyObj?: Record<string, unknown>, signed = false): Promise<T> {
    if (Date.now() < this.health.cooldownUntil) throw new Error(`OKX cooldown active until ${this.health.cooldownUntil}`);
    const qs = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const pathWithQuery = qs.toString() ? `${path}?${qs.toString()}` : path;
    const url = `${this.apiBase}${pathWithQuery}`;
    const body = bodyObj ? JSON.stringify(bodyObj) : "";
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(signed ? this.signedHeaders(method, pathWithQuery, body) : {}),
        },
        body: method === "POST" ? body : undefined,
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => ({}))) as OkxApiResponse<T>;
      if (!response.ok) throw new Error(`HTTP ${response.status} @ ${url}`);
      if ((json.code ?? "0") !== "0") throw new Error(`OKX code=${json.code ?? "unknown"} msg=${json.msg ?? "unknown"} @ ${path}`);
      this.markSuccess(Date.now() - started);
      return (json.data ?? ([] as unknown)) as T;
    } catch (error) {
      this.markFailure(Date.now() - started);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getTicker(symbol: string) {
    const instId = this.toInstId(symbol);
    const rows = await this.request<Array<Record<string, string>>>("GET", "/api/v5/market/ticker", { instId }).catch(() => []);
    const row = rows[0] ?? {};
    const last = Number(row.last ?? 0);
    const open24h = Number(row.open24h ?? 0);
    return {
      symbol: symbol.toUpperCase(),
      price: last,
      change24h: open24h > 0 ? Number((((last - open24h) / open24h) * 100).toFixed(4)) : 0,
      volume24h: Number(row.volCcy24h ?? row.vol24h ?? 0),
    };
  }

  async getKlines(symbol: string, interval = "1m", limit = 100): Promise<KlineItem[]> {
    const instId = this.toInstId(symbol);
    const rows = await this.request<Array<[string, string, string, string, string, string]>>("GET", "/api/v5/market/candles", {
      instId,
      bar: this.intervalToBar(interval),
      limit: Math.min(limit, 300),
    }).catch(() => []);
    return rows.map((x) => ({
      openTime: Number(x[0]),
      closeTime: Number(x[0]) + 60_000,
      open: Number(x[1]),
      high: Number(x[2]),
      low: Number(x[3]),
      close: Number(x[4]),
      volume: Number(x[5]),
    }));
  }

  async getOrderBook(symbol: string, limit = 50): Promise<OrderBookSnapshot> {
    const instId = this.toInstId(symbol);
    const rows = await this.request<Array<{ asks?: Array<[string, string]>; bids?: Array<[string, string]>; ts?: string }>>("GET", "/api/v5/market/books", {
      instId,
      sz: Math.min(limit, 400),
    }).catch(() => []);
    const row = rows[0];
    if (!row) return { bids: [], asks: [] };
    return {
      lastUpdateId: Number(row.ts ?? Date.now()),
      asks: (row.asks ?? []).slice(0, limit).map((a) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
      bids: (row.bids ?? []).slice(0, limit).map((b) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
    };
  }

  async getRecentTrades(symbol: string, limit = 50): Promise<RecentTrade[]> {
    const instId = this.toInstId(symbol);
    const rows = await this.request<Array<{ tradeId?: string; px?: string; sz?: string; ts?: string; side?: string }>>("GET", "/api/v5/market/trades", {
      instId,
      limit: Math.min(limit, 100),
    }).catch(() => []);
    return rows.map((x, i) => ({
      id: Number(x.tradeId ?? Date.now() + i),
      price: Number(x.px ?? 0),
      qty: Number(x.sz ?? 0),
      time: Number(x.ts ?? Date.now()),
      isBuyerMaker: x.side === "sell",
    }));
  }

  private async place(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const symbol = req.symbol.toUpperCase();
    if ((req.dryRun ?? this.dryRun) || !this.key || !this.secret || !this.passphrase) {
      return { orderId: `okx-sim-${randomUUID()}`, clientOrderId: `sim-${Date.now()}`, symbol, status: "SIMULATED", side: req.side, type: req.type, executedQty: req.quantity, price: req.price, dryRun: true };
    }
    const instId = this.toInstId(symbol);
    const payload: Record<string, string> = { instId, tdMode: "cash", side: req.side.toLowerCase(), ordType: req.type === "MARKET" ? "market" : "limit", sz: String(req.quantity) };
    if (req.type === "LIMIT" && req.price) payload.px = String(req.price);
    const rows = await this.request<Array<{ ordId?: string; clOrdId?: string; sCode?: string; sMsg?: string }>>("POST", "/api/v5/trade/order", undefined, payload, true);
    const row = rows[0] ?? {};
    if ((row.sCode ?? "0") !== "0") throw new Error(`OKX order failed: ${row.sCode ?? "unknown"} ${row.sMsg ?? ""}`.trim());
    return { orderId: String(row.ordId ?? ""), clientOrderId: String(row.clOrdId ?? ""), symbol, status: req.type === "MARKET" ? "FILLED" : "NEW", side: req.side, type: req.type, executedQty: req.quantity, price: req.price, dryRun: false };
  }

  placeMarketBuy(symbol: string, quantity: number, dryRun?: boolean) { return this.place({ symbol, side: "BUY", type: "MARKET", quantity, dryRun }); }
  placeMarketSell(symbol: string, quantity: number, dryRun?: boolean) { return this.place({ symbol, side: "SELL", type: "MARKET", quantity, dryRun }); }
  placeLimitBuy(symbol: string, quantity: number, price: number, dryRun?: boolean) { return this.place({ symbol, side: "BUY", type: "LIMIT", quantity, price, dryRun }); }
  placeLimitSell(symbol: string, quantity: number, price: number, dryRun?: boolean) { return this.place({ symbol, side: "SELL", type: "LIMIT", quantity, price, dryRun }); }

  async cancelOrder(symbol: string, orderId: string) {
    if (this.dryRun || !this.key || !this.secret || !this.passphrase) return { symbol: symbol.toUpperCase(), orderId, status: "CANCELED_SIMULATED" };
    await this.request("POST", "/api/v5/trade/cancel-order", undefined, { instId: this.toInstId(symbol), ordId: orderId }, true);
    return { symbol: symbol.toUpperCase(), orderId, status: "CANCELED" };
  }

  async getOrderStatus(symbol: string, orderId: string) {
    if (this.dryRun || !this.key || !this.secret || !this.passphrase) return { symbol: symbol.toUpperCase(), orderId, status: "SIMULATED", updatedAt: new Date().toISOString() };
    const rows = await this.request<Array<Record<string, string>>>("GET", "/api/v5/trade/order", { instId: this.toInstId(symbol), ordId: orderId }, undefined, true);
    return rows[0] ?? {};
  }

  async getExchangeInfo(): Promise<ExchangeInfoResponse> {
    if (this.cachedExchangeInfo && Date.now() - this.cacheAt < 60_000) return this.cachedExchangeInfo;
    const rows = await this.request<Array<Record<string, string>>>("GET", "/api/v5/public/instruments", { instType: "SPOT" }).catch(() => []);
    const symbols: ExchangeSymbolInfo[] = rows.map((row) => ({
      symbol: this.fromInstId(row.instId ?? ""),
      status: row.state === "live" ? "TRADING" : "BREAK",
      baseAsset: String(row.baseCcy ?? "").toUpperCase(),
      quoteAsset: String(row.quoteCcy ?? "").toUpperCase(),
      filters: {
        LOT_SIZE: { minQty: row.minSz ?? "0.00000001", maxQty: row.maxLmtSz ?? "999999999", stepSize: row.lotSz ?? "0.00000001" },
        PRICE_FILTER: { minPrice: "0", maxPrice: "999999999", tickSize: row.tickSz ?? "0.00000001" },
        MIN_NOTIONAL: { minNotional: row.minSz ?? "0.00000001" },
      },
    }));
    this.cachedExchangeInfo = { timezone: "UTC", serverTime: Date.now(), symbols };
    this.cacheAt = Date.now();
    return this.cachedExchangeInfo;
  }

  async validateSymbolFilters(symbol: string, quantity: number): Promise<SymbolValidationResult> {
    const info = await this.getExchangeInfo();
    const found = info.symbols.find((x) => x.symbol === symbol.toUpperCase());
    if (!found) return { ok: false, reasons: ["Symbol not found"] };
    const minQty = Number(found.filters.LOT_SIZE.minQty ?? 0);
    const step = Number(found.filters.LOT_SIZE.stepSize ?? 0.00000001);
    let adjustedQuantity = Math.max(quantity, minQty);
    adjustedQuantity = Number((Math.floor(adjustedQuantity / step) * step).toFixed(8));
    return { ok: adjustedQuantity > 0, reasons: adjustedQuantity > 0 ? [] : ["Quantity invalid"], adjustedQuantity };
  }

  async calculateValidQuantity(symbol: string, quantity: number): Promise<number> {
    const res = await this.validateSymbolFilters(symbol, quantity);
    if (!res.ok || !res.adjustedQuantity) throw new Error(`calculateValidQuantity failed: ${res.reasons.join(", ")}`);
    return res.adjustedQuantity;
  }

  async estimateFees(symbol: string, side: "BUY" | "SELL", quantity: number, price: number): Promise<FeeEstimate> {
    const notional = quantity * price;
    const taker = env.OKX_TAKER_FEE_RATE;
    const maker = env.OKX_MAKER_FEE_RATE;
    return {
      symbol: symbol.toUpperCase(),
      side,
      quantity,
      price,
      takerFeeRate: taker,
      makerFeeRate: maker,
      estimatedTakerFee: Number((notional * taker).toFixed(8)),
      estimatedMakerFee: Number((notional * maker).toFixed(8)),
    };
  }

  async getAccountBalances(): Promise<ExchangeBalance[]> {
    if (!this.key || !this.secret || !this.passphrase) return [];
    const rows = await this.request<Array<{ details?: Array<{ ccy?: string; cashBal?: string; frozenBal?: string }> }>>("GET", "/api/v5/account/balance", undefined, undefined, true).catch(() => []);
    const details = rows[0]?.details ?? [];
    return details.map((d) => {
      const free = Number(d.cashBal ?? 0);
      const locked = Number(d.frozenBal ?? 0);
      return { asset: String(d.ccy ?? "").toUpperCase(), free, locked, total: Number((free + locked).toFixed(8)) };
    }).filter((x) => x.asset);
  }

  subscribeTicker(symbol: string, onData: (data: { symbol: string; price: number; eventTime: number }) => void) {
    const timer = setInterval(async () => {
      const t = await this.getTicker(symbol);
      onData({ symbol: t.symbol, price: t.price, eventTime: Date.now() });
    }, 2000);
    return () => clearInterval(timer);
  }

  getPublicEndpointHealth() {
    return [{
      base: this.apiBase,
      score: Number((this.health.latencyEwmaMs + this.health.consecutiveFailures * 100).toFixed(2)),
      totalCalls: this.health.totalCalls,
      successes: this.health.successes,
      failures: this.health.failures,
      consecutiveFailures: this.health.consecutiveFailures,
      latencyEwmaMs: Number(this.health.latencyEwmaMs.toFixed(2)),
      lastLatencyMs: this.health.lastLatencyMs,
      latencySamples: this.health.latencySamples,
      cooldownUntil: this.health.cooldownUntil > 0 ? new Date(this.health.cooldownUntil).toISOString() : null,
    }];
  }

  getRuntimeStatus() {
    const now = Date.now();
    return {
      fallbackActive: this.health.cooldownUntil > now,
      globalBanActive: false,
      networkCooldownActive: this.health.cooldownUntil > now,
      globalBanUntil: null,
      networkCooldownUntil: this.health.cooldownUntil > 0 ? new Date(this.health.cooldownUntil).toISOString() : null,
    };
  }
}

