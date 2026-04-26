import Binance from "binance-api-node";
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
import { SimpleRateLimiter, withRetry } from "@/src/server/exchange/utils";
import type { ExchangeProvider } from "@/src/server/exchange/providers/base-provider";

type BinanceCtor = ReturnType<typeof Binance>;
type EndpointHealthState = {
  totalCalls: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastFailureAt: number;
  cooldownUntil: number;
  latencyEwmaMs: number;
  lastLatencyMs: number;
  latencySamples: number[];
};

const TR_MARKETDATA_TIMEOUT_MS = 5000;

export class BinanceExchangeProvider implements ExchangeProvider {
  public readonly name = "binance";
  public readonly environment: ExchangeEnvironment;
  public readonly dryRun: boolean;

  private readonly client: BinanceCtor | null;
  private readonly limiter = new SimpleRateLimiter(20, 1000);
  private cachedExchangeInfo: ExchangeInfoResponse | null = null;
  private cacheAt = 0;
  private readonly httpBases: string[];
  private readonly endpointHealth = new Map<string, EndpointHealthState>();
  private globalBanUntil = 0;
  private globalNetworkIssueUntil = 0;
  private lastCooldownLogAt = 0;
  private lastNetworkCooldownLogAt = 0;
  private readonly warnThrottle = new Map<string, number>();
  private readonly platform: "global" | "tr";
  private lastKnownBalances: ExchangeBalance[] = [];
  private lastKnownBalancesAt = 0;
  private readonly tickerCache = new Map<string, { value: { symbol: string; price: number; change24h: number; volume24h: number }; at: number }>();
  private networkFailureStreak = 0;
  private networkFailureWindowStartAt = 0;

  constructor() {
    this.environment = env.BINANCE_ENV ?? "testnet";
    this.platform = env.BINANCE_PLATFORM ?? "global";
    this.dryRun = env.BINANCE_DRY_RUN ?? true;
    const useLive = this.environment === "live";
    const trLiveBase = env.BINANCE_TR_HTTP_BASE;
    const trOnly = this.platform === "tr";
    this.client = Binance({
      apiKey: env.BINANCE_API_KEY,
      apiSecret: env.BINANCE_API_SECRET,
      httpBase: trOnly ? trLiveBase : useLive ? undefined : "https://testnet.binance.vision",
      wsBase: trOnly ? undefined : useLive ? undefined : "wss://testnet.binance.vision/ws",
    }) as BinanceCtor;
    const configured = env.BINANCE_PUBLIC_HTTP_BASES.split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const configuredFiltered = trOnly
      ? configured.filter((base) => base.includes("binance.tr") || base.includes("api.binance.me"))
      : configured;
    const defaults = useLive
      ? this.platform === "tr"
        ? ["https://api.binance.me", trLiveBase]
        : ["https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com"]
      : this.platform === "tr"
        ? ["https://api.binance.me", trLiveBase]
        : ["https://testnet.binance.vision", "https://api.binance.com", "https://api1.binance.com", "https://api2.binance.com", "https://api3.binance.com"];
    this.httpBases = Array.from(new Set([...defaults, ...(trOnly ? configuredFiltered : configured)]));
    for (const base of this.httpBases) {
      this.endpointHealth.set(base, {
        totalCalls: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        lastFailureAt: 0,
        cooldownUntil: 0,
        latencyEwmaMs: 0,
        lastLatencyMs: 0,
        latencySamples: [],
      });
    }

    logger.info(
      {
        provider: this.name,
        environment: this.environment,
        platform: this.platform,
        dryRun: this.dryRun,
        hasAuth: Boolean(env.BINANCE_API_KEY && env.BINANCE_API_SECRET),
        httpBases: this.httpBases,
      },
      "Binance provider initialized",
    );
  }

  private async call<T>(opName: string, fn: () => Promise<T>): Promise<T> {
    const isPublicOrDiscoveryOp =
      opName === "getTicker" ||
      opName === "getKlines" ||
      opName === "getOrderBook" ||
      opName === "getRecentTrades" ||
      opName === "getExchangeInfo";
    if (isPublicOrDiscoveryOp && Date.now() < this.globalBanUntil) {
      throw new Error(`Binance cooldown active until ${this.globalBanUntil}`);
    }
    if (isPublicOrDiscoveryOp && Date.now() < this.globalNetworkIssueUntil && !(this.platform === "tr" && this.httpBases.length > 1)) {
      throw new Error(`Binance network cooldown active until ${this.globalNetworkIssueUntil}`);
    }
    await this.limiter.waitTurn();
    const isMarketDataOp =
      opName === "getTicker" ||
      opName === "getKlines" ||
      opName === "getOrderBook" ||
      opName === "getRecentTrades";
    return withRetry(opName, fn, {
      retries: isMarketDataOp ? 1 : 2,
      initialDelayMs: isMarketDataOp ? 150 : 250,
      maxDelayMs: isMarketDataOp ? 600 : 1200,
      timeoutMs: isMarketDataOp ? Math.min(env.BINANCE_TIMEOUT_MS ?? 5000, 3000) : (env.BINANCE_TIMEOUT_MS ?? 5000),
    });
  }

  private parseBanUntilFromMessage(message: string) {
    const lower = message.toLowerCase();
    if (
      !lower.includes("ip banned until")
    ) {
      return 0;
    }
    const numeric = message.match(/\b(\d{13})\b/);
    if (numeric?.[1]) {
      const ts = Number(numeric[1]);
      if (Number.isFinite(ts) && ts > Date.now()) return ts;
    }
    return Date.now() + 90_000;
  }

  private isGlobalCooldownActive() {
    return Date.now() < this.globalBanUntil;
  }

  private isGlobalNetworkCooldownActive() {
    return Date.now() < this.globalNetworkIssueUntil;
  }

  private isNetworkErrorMessage(message: string) {
    const lower = message.toLowerCase();
    return (
      lower.includes("read econnreset") ||
      lower.includes("fetch failed") ||
      lower.includes("socket hang up") ||
      lower.includes("etimedout") ||
      lower.includes("enotfound") ||
      lower.includes("econnrefused") ||
      lower.includes("operation was aborted") ||
      lower.includes("aborted")
    );
  }

  private shouldLogWarn(key: string, intervalMs = 8000) {
    const now = Date.now();
    const last = this.warnThrottle.get(key) ?? 0;
    if (now - last < intervalMs) return false;
    this.warnThrottle.set(key, now);
    return true;
  }

  private pickOrderPayload(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== "object") return {};
    const root = input as Record<string, unknown>;
    const candidates: Record<string, unknown>[] = [root];
    const nestedKeys = ["data", "result", "order", "response", "payload"] as const;
    for (const key of nestedKeys) {
      const nested = root[key];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        candidates.push(nested as Record<string, unknown>);
      }
    }
    const hasOrderFields = (obj: Record<string, unknown>) =>
      "orderId" in obj ||
      "order_id" in obj ||
      "id" in obj ||
      "status" in obj ||
      "orderStatus" in obj ||
      "executedQty" in obj ||
      "executed_quantity" in obj;
    return candidates.find(hasOrderFields) ?? root;
  }

  private toTrOrderSymbol(symbol: string) {
    const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const quotes = ["USDT", "TRY", "BUSD", "USDC", "BTC", "ETH"];
    const quote = quotes.find((q) => normalized.endsWith(q));
    if (!quote) return normalized;
    const base = normalized.slice(0, normalized.length - quote.length);
    return base && quote ? `${base}_${quote}` : normalized;
  }

  private mapOrderSideToTr(side: "BUY" | "SELL") {
    return side === "BUY" ? 0 : 1;
  }

  private mapOrderTypeToTr(type: "MARKET" | "LIMIT") {
    return type === "LIMIT" ? 1 : 2;
  }

  private mapTimeInForceToTr(timeInForce?: "GTC" | "IOC" | "FOK") {
    if (timeInForce === "IOC") return 2;
    if (timeInForce === "FOK") return 3;
    return 1;
  }

  private mapTrOrderStatus(value: unknown) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      if (asNumber === 1) return "PARTIALLY_FILLED";
      if (asNumber === 2) return "FILLED";
      if (asNumber === 3) return "CANCELED";
      if (asNumber === 5) return "REJECTED";
      if (asNumber === 6) return "EXPIRED";
      return "NEW";
    }
    const asText = String(value ?? "").toUpperCase();
    if (asText.includes("PARTIALLY")) return "PARTIALLY_FILLED";
    if (asText.includes("FILLED")) return "FILLED";
    if (asText.includes("CANCELED")) return "CANCELED";
    if (asText.includes("REJECT")) return "REJECTED";
    if (asText.includes("EXPIRED")) return "EXPIRED";
    return "NEW";
  }

  private async fetchTrSignedJson<T>(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<T> {
    if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET) {
      throw new Error("Binance API key/secret not configured");
    }
    const base = env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "");
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) body.set(key, String(value));
    }
    if (!body.has("timestamp")) body.set("timestamp", String(Date.now()));
    if (!body.has("recvWindow")) body.set("recvWindow", "5000");
    const payload = body.toString();
    const signature = createHmac("sha256", env.BINANCE_API_SECRET).update(payload).digest("hex");
    body.set("signature", signature);
    const url = `${base}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "X-MBX-APIKEY": env.BINANCE_API_KEY,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });
    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} @ ${path} ${txt}`.trim());
    }
    const raw = (await response.json()) as {
      code?: number;
      msg?: string;
      message?: string;
      data?: unknown;
      timestamp?: number;
    };
    if ((raw.code ?? 0) !== 0) {
      throw new Error(`TR API code=${raw.code ?? "unknown"} msg=${raw.msg ?? raw.message ?? "unknown"} @ ${path}`);
    }
    return ((raw.data ?? raw) as T);
  }

  private maybeLogCooldown(reason: string) {
    const now = Date.now();
    if (now - this.lastCooldownLogAt < 10_000) return;
    this.lastCooldownLogAt = now;
    logger.warn(
      { reason, banUntil: this.globalBanUntil, iso: new Date(this.globalBanUntil).toISOString() },
      "Binance cooldown active, using local fallback data",
    );
  }

  private maybeLogNetworkCooldown(reason: string) {
    const now = Date.now();
    if (now - this.lastNetworkCooldownLogAt < 10_000) return;
    this.lastNetworkCooldownLogAt = now;
    logger.warn(
      { reason, until: this.globalNetworkIssueUntil, iso: new Date(this.globalNetworkIssueUntil).toISOString() },
      "Binance network unstable, using local fallback data",
    );
  }

  private fallbackTicker(symbol: string) {
    const cached = this.getCachedTicker(symbol);
    if (cached) return cached;
    const price = this.toFallbackPrice(symbol);
    return {
      symbol,
      price,
      change24h: 0,
      // Keep fallback liquidity very low so risk/scanner can reject synthetic data.
      volume24h: 0,
    };
  }

  private rememberTicker(value: { symbol: string; price: number; change24h: number; volume24h: number }) {
    if (!Number.isFinite(value.price) || value.price <= 0) return;
    const normalized = value.symbol.toUpperCase();
    this.tickerCache.set(normalized, { value: { ...value, symbol: normalized }, at: Date.now() });
  }

  private getCachedTicker(symbol: string) {
    const normalized = symbol.toUpperCase();
    const direct = this.tickerCache.get(normalized);
    const freshMs = 15 * 60 * 1000;
    if (direct && Date.now() - direct.at < freshMs) return { ...direct.value };

    for (const candidate of this.symbolVariants(normalized)) {
      const row = this.tickerCache.get(candidate);
      if (row && Date.now() - row.at < freshMs) {
        return { ...row.value, symbol: candidate };
      }
    }
    return null;
  }

  private fallbackKlines(symbol: string, limit: number): KlineItem[] {
    const base = this.toFallbackPrice(symbol);
    const now = Date.now();
    return Array.from({ length: limit }).map((_, index) => {
      const drift = ((index % 6) - 3) * 0.0008;
      const open = base * (1 + drift);
      const close = base * (1 + drift * 0.95);
      const high = Math.max(open, close) * 1.0008;
      const low = Math.min(open, close) * 0.9992;
      return {
        openTime: now - (limit - index) * 60_000,
        closeTime: now - (limit - index - 1) * 60_000,
        open: Number(open.toFixed(8)),
        high: Number(high.toFixed(8)),
        low: Number(low.toFixed(8)),
        close: Number(close.toFixed(8)),
        volume: 0,
      };
    });
  }

  private fallbackOrderBook(symbol: string, limit: number): OrderBookSnapshot {
    const mid = this.toFallbackPrice(symbol);
    const depth = Math.min(limit, 20);
    return {
      bids: Array.from({ length: depth }).map((_, i) => ({
        price: Number((mid * (1 - i * 0.0007)).toFixed(8)),
        quantity: 0,
      })),
      asks: Array.from({ length: depth }).map((_, i) => ({
        price: Number((mid * (1 + i * 0.0007)).toFixed(8)),
        quantity: 0,
      })),
    };
  }

  private fallbackRecentTrades(symbol: string, limit: number): RecentTrade[] {
    const price = this.toFallbackPrice(symbol);
    const now = Date.now();
    return Array.from({ length: Math.min(limit, 20) }).map((_, i) => ({
      id: now - i,
      price: Number(price.toFixed(8)),
      qty: 0,
      time: now - i * 1200,
      isBuyerMaker: i % 2 === 0,
    }));
  }

  private markGlobalBanFromError(error: unknown) {
    const message = (error as Error)?.message ?? "";
    const banUntil = this.parseBanUntilFromMessage(message);
    if (banUntil > this.globalBanUntil + 5_000) {
      this.globalBanUntil = banUntil;
      logger.warn({ banUntil, iso: new Date(banUntil).toISOString() }, "Binance global cooldown activated");
    } else if (banUntil > this.globalBanUntil) {
      this.globalBanUntil = banUntil;
    }
  }

  private getCachedBalances() {
    if (!this.lastKnownBalances.length) return null;
    return this.lastKnownBalances.map((row) => ({ ...row }));
  }

  private markNetworkIssueFromError(error: unknown) {
    const message = (error as Error)?.message ?? "";
    if (this.platform === "tr" && message.toLowerCase().includes("www.binance.tr")) {
      return;
    }
    if (!this.isNetworkErrorMessage(message)) return;
    const now = Date.now();
    if (now - this.networkFailureWindowStartAt > 12_000) {
      this.networkFailureWindowStartAt = now;
      this.networkFailureStreak = 0;
    }
    this.networkFailureStreak += 1;
    if (this.networkFailureStreak < 3) {
      return;
    }
    const until = now + 20_000;
    if (until > this.globalNetworkIssueUntil + 5_000) {
      this.globalNetworkIssueUntil = until;
      if (this.shouldLogWarn("binance-network-cooldown", 15_000)) {
        logger.warn(
          { until, iso: new Date(until).toISOString(), networkFailureStreak: this.networkFailureStreak },
          "Binance network cooldown activated",
        );
      }
    } else if (until > this.globalNetworkIssueUntil) {
      this.globalNetworkIssueUntil = until;
    }
  }

  private markNetworkHealthy() {
    this.networkFailureStreak = 0;
    this.networkFailureWindowStartAt = Date.now();
    if (Date.now() >= this.globalNetworkIssueUntil) return;
    this.globalNetworkIssueUntil = 0;
    if (this.shouldLogWarn("binance-network-recovered", 15_000)) {
      logger.info("Binance network recovered, cooldown cleared");
    }
  }

  private toFallbackPrice(symbol: string) {
    const seed = symbol
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return Number((100 + (seed % 1000) * 3.21).toFixed(2));
  }

  private pickArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) return value as T[];
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (Array.isArray(obj.data)) return obj.data as T[];
      if (Array.isArray(obj.list)) return obj.list as T[];
      if (Array.isArray(obj.rows)) return obj.rows as T[];
      if (Array.isArray(obj.result)) return obj.result as T[];
    }
    return [];
  }

  private normalizeDepthSide(side: unknown): Array<[string, string]> {
    if (Array.isArray(side)) {
      const rows = side as unknown[];
      return rows
        .map((row) => {
          if (!Array.isArray(row) || row.length < 2) return null;
          return [String(row[0]), String(row[1])] as [string, string];
        })
        .filter((x): x is [string, string] => Boolean(x));
    }
    if (side && typeof side === "object") {
      return Object.entries(side as Record<string, string | number>).map(([price, qty]) => [String(price), String(qty)]);
    }
    return [];
  }

  private symbolVariants(symbol: string) {
    const normalized = symbol.toUpperCase();
    const variants = new Set<string>([normalized]);
    if (normalized.endsWith("USDT")) variants.add(`${normalized.slice(0, -4)}TRY`);
    if (normalized.endsWith("TRY")) variants.add(`${normalized.slice(0, -3)}USDT`);
    return Array.from(variants);
  }

  private toTrOpenSymbol(symbol: string) {
    const normalized = symbol.toUpperCase().replace(/[^A-Z0-9_]/g, "");
    if (normalized.includes("_")) return normalized;
    if (normalized.endsWith("TRY")) return `${normalized.slice(0, -3)}_TRY`;
    if (normalized.endsWith("USDT")) return `${normalized.slice(0, -4)}_USDT`;
    return `${normalized}_TRY`;
  }

  private normalizeTrDepthLimit(limit: number) {
    const allowed = [5, 10, 20, 50, 100];
    const wanted = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
    const exact = allowed.find((x) => x === wanted);
    if (exact) return exact;
    const nearest = allowed.find((x) => x >= wanted);
    return nearest ?? 100;
  }

  private estimateTickerFromOrderBook(
    symbol: string,
    bids: Array<[string, string]>,
    asks: Array<[string, string]>,
  ): { symbol: string; price: number; change24h: number; volume24h: number } | null {
    if (bids.length === 0 || asks.length === 0) return null;
    const bestBid = Number(bids[0]?.[0] ?? 0);
    const bestAsk = Number(asks[0]?.[0] ?? 0);
    if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) return null;
    const price = Number((((bestBid + bestAsk) / 2) || bestAsk || bestBid).toFixed(8));
    return {
      symbol: symbol.toUpperCase(),
      price,
      change24h: 0,
      // Depth-derived ticker is fallback-only; avoid inventing fake 24h liquidity.
      volume24h: 0,
    };
  }

  private ensureClient(opName: string) {
    if (!this.client) {
      throw new Error(`${opName}: Binance client not configured`);
    }
    return this.client;
  }

  private getHealth(base: string): EndpointHealthState {
    const current = this.endpointHealth.get(base);
    if (current) return current;
    const initial: EndpointHealthState = {
      totalCalls: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      lastFailureAt: 0,
      cooldownUntil: 0,
      latencyEwmaMs: 0,
      lastLatencyMs: 0,
      latencySamples: [],
    };
    this.endpointHealth.set(base, initial);
    return initial;
  }

  private scoreBase(base: string, now: number) {
    const h = this.getHealth(base);
    const cooldownPenalty = h.cooldownUntil > now ? 5_000 : 0;
    const failurePenalty = h.consecutiveFailures * 400 + h.failures * 60;
    const successBonus = Math.min(h.successes * 4, 400);
    const latencyBase = h.totalCalls > 0 ? Math.max(h.latencyEwmaMs, 1) : (env.BINANCE_TIMEOUT_MS ?? 5000);
    return latencyBase + cooldownPenalty + failurePenalty - successBonus;
  }

  getPublicEndpointHealth() {
    const now = Date.now();
    return this.getOrderedBases().map((base) => {
      const h = this.getHealth(base);
      return {
        base,
        score: Number(this.scoreBase(base, now).toFixed(2)),
        totalCalls: h.totalCalls,
        successes: h.successes,
        failures: h.failures,
        consecutiveFailures: h.consecutiveFailures,
        latencyEwmaMs: Number((h.totalCalls > 0 ? h.latencyEwmaMs : 0).toFixed(2)),
        lastLatencyMs: h.lastLatencyMs,
        latencySamples: h.latencySamples,
        cooldownUntil: h.cooldownUntil > 0 ? new Date(h.cooldownUntil).toISOString() : null,
      };
    });
  }

  getRuntimeStatus() {
    const now = Date.now();
    const globalBanActive = this.globalBanUntil > now;
    const networkCooldownActive = this.globalNetworkIssueUntil > now;
    return {
      fallbackActive: globalBanActive || networkCooldownActive,
      globalBanActive,
      networkCooldownActive,
      globalBanUntil: this.globalBanUntil > 0 ? new Date(this.globalBanUntil).toISOString() : null,
      networkCooldownUntil: this.globalNetworkIssueUntil > 0 ? new Date(this.globalNetworkIssueUntil).toISOString() : null,
    };
  }

  private getOrderedBases() {
    const now = Date.now();
    return [...this.httpBases].sort((a, b) => this.scoreBase(a, now) - this.scoreBase(b, now));
  }

  private markBaseSuccess(base: string, latencyMs: number) {
    const h = this.getHealth(base);
    h.totalCalls += 1;
    h.successes += 1;
    h.consecutiveFailures = 0;
    h.cooldownUntil = 0;
    h.lastLatencyMs = latencyMs;
    h.latencyEwmaMs = h.latencyEwmaMs <= 0 ? latencyMs : h.latencyEwmaMs * 0.7 + latencyMs * 0.3;
    h.latencySamples = [...h.latencySamples, latencyMs].slice(-10);
    this.endpointHealth.set(base, h);
  }

  private markBaseFailure(base: string, latencyMs: number) {
    const h = this.getHealth(base);
    h.totalCalls += 1;
    h.failures += 1;
    h.consecutiveFailures += 1;
    h.lastFailureAt = Date.now();
    h.lastLatencyMs = latencyMs;
    h.latencyEwmaMs = h.latencyEwmaMs <= 0 ? latencyMs : h.latencyEwmaMs * 0.8 + latencyMs * 0.2;
    h.latencySamples = [...h.latencySamples, latencyMs].slice(-10);
    const baseCooldown = 2_000;
    const multiplier = Math.min(2 ** Math.max(h.consecutiveFailures - 1, 0), 32);
    h.cooldownUntil = Date.now() + baseCooldown * multiplier;
    this.endpointHealth.set(base, h);
  }

  private setBaseCooldown(base: string, msFromNow: number) {
    const h = this.getHealth(base);
    h.cooldownUntil = Math.max(h.cooldownUntil, Date.now() + Math.max(500, msFromNow));
    this.endpointHealth.set(base, h);
  }

  private isTrPublicApiV3Base(base: string, path: string) {
    if (this.platform !== "tr") return false;
    return base.toLowerCase().includes("binance.tr") && path.toLowerCase().startsWith("/api/v3/");
  }

  private isTrPublicAuthEnvelopeError(base: string, path: string, message: string) {
    if (!this.isTrPublicApiV3Base(base, path)) return false;
    return message.toLowerCase().includes("tr api code=3701");
  }

  private async fetchPublicJson<T>(
    path: string,
    query?: Record<string, string | number | undefined>,
    timeoutMs?: number,
  ): Promise<T> {
    if (Date.now() < this.globalBanUntil) {
      throw new Error(`Binance cooldown active until ${this.globalBanUntil}`);
    }
    if (Date.now() < this.globalNetworkIssueUntil && !(this.platform === "tr" && this.httpBases.length > 1)) {
      throw new Error(`Binance network cooldown active until ${this.globalNetworkIssueUntil}`);
    }
    let lastError: Error | null = null;
    const qs = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
    }
    const suffix = qs.toString() ? `${path}?${qs.toString()}` : path;

    const orderedBases = this.getOrderedBases();
    const preferredBases = orderedBases.filter((base) => !this.isTrPublicApiV3Base(base, path));
    const bases = preferredBases.length > 0 ? preferredBases : orderedBases;
    if (bases.length !== orderedBases.length && this.shouldLogWarn("tr-public-v3-skip-binance-tr", 60_000)) {
      logger.info(
        { path, skippedBases: orderedBases.filter((base) => this.isTrPublicApiV3Base(base, path)) },
        "TR mode: skipping binance.tr api/v3 public base, using api.binance.me",
      );
    }

    for (const base of bases) {
      const url = `${base}${suffix}`;
      const controller = new AbortController();
      const effectiveTimeout = timeoutMs ?? Math.min(env.BINANCE_TIMEOUT_MS ?? 5000, 3000);
      const timeout = setTimeout(() => {
        try {
          if (!controller.signal.aborted) controller.abort();
        } catch {
          // noop
        }
      }, effectiveTimeout);
      const startedAt = Date.now();
      try {
        const response = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        });
        if (!response.ok) {
          let detail = "";
          try {
            const body = (await response.json()) as { msg?: string };
            detail = body?.msg ? ` - ${body.msg}` : "";
            this.markGlobalBanFromError(new Error(body?.msg ?? ""));
          } catch {
            detail = "";
          }
          throw new Error(`HTTP ${response.status} @ ${url}${detail}`);
        }
        const raw = (await response.json()) as unknown;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          const envelope = raw as { code?: number; msg?: string; message?: string; data?: unknown };
          if (typeof envelope.code === "number" && envelope.code !== 0) {
            throw new Error(
              `TR API code=${envelope.code} msg=${envelope.msg ?? envelope.message ?? "unknown"} @ ${url}`,
            );
          }
          // Binance TR endpoints can wrap payload inside { code: 0, data: ... }.
          // Unwrap here so downstream callers receive canonical payload.
          if (typeof envelope.code === "number") {
            const json = (envelope.data ?? raw) as T;
            this.markBaseSuccess(base, Date.now() - startedAt);
            this.markNetworkHealthy();
            return json;
          }
        }
        const json = raw as T;
        this.markBaseSuccess(base, Date.now() - startedAt);
        this.markNetworkHealthy();
        return json;
      } catch (error) {
        lastError = error as Error;
        this.markGlobalBanFromError(error);
        this.markNetworkIssueFromError(error);
        this.markBaseFailure(base, Date.now() - startedAt);
        const isNetwork = this.isNetworkErrorMessage(lastError.message);
        const isTrAuthEnvelope = this.isTrPublicAuthEnvelopeError(base, path, lastError.message);
        if (isTrAuthEnvelope) {
          this.setBaseCooldown(base, 5 * 60_000);
          if (this.shouldLogWarn(`tr-public-auth-envelope:${base}`, 60_000)) {
            logger.info({ base, path }, "TR public api/v3 endpoint returned auth envelope; cooling down this base");
          }
        }
        if (isNetwork) {
          if (this.shouldLogWarn("binance-public-network-failed", 20_000)) {
            logger.warn({ error: lastError.message }, "Public Binance network failure, switching fallback");
          }
        } else if (!isTrAuthEnvelope && this.shouldLogWarn(`public:${base}:${path}`, 8_000)) {
          logger.warn({ url, error: lastError.message }, "Public Binance endpoint failed, trying next");
        }
        if (Date.now() < this.globalBanUntil || Date.now() < this.globalNetworkIssueUntil) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error("All Binance public endpoints failed");
  }

  private async fetchTrOpenJson<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const base = env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "");
    const qs = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) qs.set(k, String(v));
      }
    }
    const suffix = qs.toString() ? `${path}?${qs.toString()}` : path;
    const url = `${base}${suffix}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.BINANCE_TIMEOUT_MS ?? 5000);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} @ ${url}`);
      }
      const raw = (await response.json()) as { code?: number; msg?: string; data?: unknown };
      if ((raw.code ?? 0) !== 0) {
        throw new Error(`TR API code=${raw.code ?? "unknown"} msg=${raw.msg ?? "unknown"} @ ${url}`);
      }
      this.markNetworkHealthy();
      return (raw.data ?? raw) as T;
    } catch (error) {
      // Symbol metadata endpoint is best-effort in TR mode.
      if (!path.includes("/open/v1/common/symbols")) {
        this.markNetworkIssueFromError(error);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getTicker(symbol: string) {
    const normalized = symbol.toUpperCase();
    if (this.platform === "tr") {
      for (const candidate of this.symbolVariants(normalized)) {
        try {
          const [priceRow, statsRow] = await Promise.all([
            this.fetchPublicJson<{ symbol?: string; price?: string }>(
              "/api/v3/ticker/price",
              { symbol: candidate },
              TR_MARKETDATA_TIMEOUT_MS,
            ),
            this.fetchPublicJson<Record<string, string>>(
              "/api/v3/ticker/24hr",
              { symbol: candidate },
              TR_MARKETDATA_TIMEOUT_MS,
            ),
          ]);
          const price = Number(priceRow.price ?? 0);
          if (!Number.isFinite(price) || price <= 0) continue;
          const result = {
            symbol: candidate,
            price,
            change24h: Number(statsRow.priceChangePercent ?? 0),
            volume24h: Number(statsRow.quoteVolume ?? statsRow.volume ?? 0),
          };
          this.rememberTicker(result);
          return result;
        } catch (error) {
          this.markGlobalBanFromError(error);
          this.markNetworkIssueFromError(error);
        }
      }
      for (const candidate of this.symbolVariants(normalized)) {
        try {
          const trSymbol = this.toTrOpenSymbol(candidate);
          const depthLimit = this.normalizeTrDepthLimit(20);
          const depth = await this.fetchTrOpenJson<{ data?: { bids?: unknown; asks?: unknown } }>("/open/v1/market/depth", {
            symbol: trSymbol,
            limit: depthLimit,
          });
          const payload = depth.data ?? depth;
          const bids = this.normalizeDepthSide((payload as { bids?: unknown }).bids);
          const asks = this.normalizeDepthSide((payload as { asks?: unknown }).asks);
          const derived = this.estimateTickerFromOrderBook(candidate, bids, asks);
          if (!derived) continue;
          this.rememberTicker(derived);
          return derived;
        } catch {
          // try next candidate
        }
      }
      return this.fallbackTicker(normalized);
    }
    if (this.isGlobalCooldownActive()) {
      this.maybeLogCooldown("getTicker");
      return this.fallbackTicker(normalized);
    }
    if (this.isGlobalNetworkCooldownActive()) {
      this.maybeLogNetworkCooldown("getTicker");
      return this.fallbackTicker(normalized);
    }
    try {
      const client = this.ensureClient("getTicker");
      return await this.call("getTicker", async () => {
        const [prices, stats] = await Promise.all([client.prices(), client.dailyStats({ symbol: normalized })]);
        const tickerStats = stats as unknown as Record<string, string | number | undefined>;
        let spotPrice = 0;
        if (Array.isArray(prices)) {
          const found = (prices as Array<{ symbol: string; price: string }>).find((row) => row.symbol === normalized);
          spotPrice = Number(found?.price ?? 0);
        } else {
          const priceMap = prices as Record<string, string>;
          spotPrice = Number(priceMap[normalized] ?? 0);
        }
        const result = {
          symbol: normalized,
          price: spotPrice,
          change24h: Number(tickerStats.priceChangePercent ?? 0),
          volume24h: Number(tickerStats.quoteVolume ?? tickerStats.volume ?? 0),
        };
        this.rememberTicker(result);
        return result;
      });
    } catch (error) {
      this.markGlobalBanFromError(error);
      this.markNetworkIssueFromError(error);
      if (this.isGlobalCooldownActive()) {
        this.maybeLogCooldown("getTicker");
        return this.fallbackTicker(normalized);
      }
      if (this.isGlobalNetworkCooldownActive()) {
        this.maybeLogNetworkCooldown("getTicker");
        return this.fallbackTicker(normalized);
      }
      if (this.shouldLogWarn("ticker-client-failover", 12_000)) {
        logger.warn({ symbol: normalized, error: (error as Error).message }, "Ticker client request failed, trying public failover");
      }
      try {
        const [priceRow, statsRow] = await Promise.all([
          this.fetchPublicJson<{ symbol: string; price: string }>("/api/v3/ticker/price", { symbol: normalized }),
          this.fetchPublicJson<Record<string, string>>("/api/v3/ticker/24hr", { symbol: normalized }),
        ]);
        const result = {
          symbol: normalized,
          price: Number(priceRow.price ?? 0),
          change24h: Number(statsRow.priceChangePercent ?? 0),
          volume24h: Number(statsRow.quoteVolume ?? statsRow.volume ?? 0),
        };
        this.rememberTicker(result);
        return result;
      } catch (fallbackError) {
        logger.warn({ symbol: normalized, error: (fallbackError as Error).message }, "Ticker fallback activated");
        return this.fallbackTicker(normalized);
      }
    }
  }

  async getKlines(symbol: string, interval = "1m", limit = 100): Promise<KlineItem[]> {
    const normalized = symbol.toUpperCase();
    if (this.platform === "tr") {
      try {
        const rawRows = await this.fetchPublicJson<unknown>("/api/v3/klines", { symbol: normalized, interval, limit }, TR_MARKETDATA_TIMEOUT_MS);
        const rows = this.pickArray<unknown[]>(rawRows).filter((row) => Array.isArray(row) && row.length >= 6);
        if (rows.length > 0) {
          return rows.map((row) => ({
            openTime: Number(row[0] ?? Date.now()),
            closeTime: Number(row[6] ?? Date.now()),
            open: Number(row[1]),
            high: Number(row[2]),
            low: Number(row[3]),
            close: Number(row[4]),
            volume: Number(row[5]),
          }));
        }
        throw new Error("TR api/v3 klines empty");
      } catch (error) {
        this.markGlobalBanFromError(error);
        this.markNetworkIssueFromError(error);
        try {
          const trSymbol = this.toTrOpenSymbol(normalized);
          const trRows = await this.fetchTrOpenJson<{ data?: { list?: unknown[] } }>("/open/v1/market/klines", {
            symbol: trSymbol,
            interval,
            limit,
          });
          const rows = this.pickArray<unknown[]>(trRows).filter((row) => Array.isArray(row) && row.length >= 6);
          if (rows.length > 0) {
            return rows.map((row) => ({
              openTime: Number(row[0] ?? Date.now()),
              closeTime: Number(row[6] ?? Date.now()),
              open: Number(row[1]),
              high: Number(row[2]),
              low: Number(row[3]),
              close: Number(row[4]),
              volume: Number(row[5]),
            }));
          }
        } catch {
          // fallback below
        }
        return this.fallbackKlines(normalized, limit);
      }
    }
    if (this.isGlobalCooldownActive()) {
      this.maybeLogCooldown("getKlines");
      return this.fallbackKlines(normalized, limit);
    }
    if (this.isGlobalNetworkCooldownActive()) {
      this.maybeLogNetworkCooldown("getKlines");
      return this.fallbackKlines(normalized, limit);
    }
    try {
      const client = this.ensureClient("getKlines");
      return await this.call("getKlines", async () => {
        const raw = await client.candles({ symbol: normalized, interval, limit });
        const rows = this.pickArray<Record<string, string | number>>(raw);
        if (rows.length === 0) {
          throw new Error("Klines response malformed: no candle rows");
        }
        return rows.map((row) => ({
          openTime: Number(row.openTime ?? Date.now()),
          closeTime: Number(row.closeTime ?? Date.now()),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume),
        }));
      });
    } catch (error) {
      this.markGlobalBanFromError(error);
      this.markNetworkIssueFromError(error);
      if (this.isGlobalCooldownActive()) {
        this.maybeLogCooldown("getKlines");
        return this.fallbackKlines(normalized, limit);
      }
      if (this.isGlobalNetworkCooldownActive()) {
        this.maybeLogNetworkCooldown("getKlines");
        return this.fallbackKlines(normalized, limit);
      }
      try {
        const rawRows = await this.fetchPublicJson<unknown>(
          "/api/v3/klines",
          { symbol: normalized, interval, limit },
          TR_MARKETDATA_TIMEOUT_MS,
        );
        const rows = this.pickArray<unknown[]>(rawRows).filter((row) => Array.isArray(row) && row.length >= 6);
        if (rows.length === 0) return this.fallbackKlines(normalized, limit);
        return rows.map((row) => ({
          openTime: Number(row[0] ?? Date.now()),
          closeTime: Number(row[6] ?? Date.now()),
          open: Number(row[1]),
          high: Number(row[2]),
          low: Number(row[3]),
          close: Number(row[4]),
          volume: Number(row[5]),
        }));
      } catch {
        return this.fallbackKlines(normalized, limit);
      }
    }
  }

  async getOrderBook(symbol: string, limit = 50): Promise<OrderBookSnapshot> {
    const normalized = symbol.toUpperCase();
    if (this.platform === "tr") {
      try {
        const rawDepth = await this.fetchPublicJson<{
          lastUpdateId?: number;
          bids?: unknown;
          asks?: unknown;
          data?: { lastUpdateId?: number; bids?: unknown; asks?: unknown };
          result?: { lastUpdateId?: number; bids?: unknown; asks?: unknown };
        }>(
          "/api/v3/depth",
          { symbol: normalized, limit: Math.min(limit, 100) },
          TR_MARKETDATA_TIMEOUT_MS,
        );
        const payload = rawDepth.data ?? rawDepth.result ?? rawDepth;
        const bids = this.normalizeDepthSide(payload.bids);
        const asks = this.normalizeDepthSide(payload.asks);
        if (bids.length === 0 || asks.length === 0) return this.fallbackOrderBook(normalized, limit);
        return {
          lastUpdateId: Number(payload.lastUpdateId ?? Date.now()),
          bids: bids.slice(0, limit).map((b) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
          asks: asks.slice(0, limit).map((a) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
        };
      } catch (error) {
        this.markGlobalBanFromError(error);
        this.markNetworkIssueFromError(error);
        try {
          const trSymbol = this.toTrOpenSymbol(normalized);
          const depthLimit = this.normalizeTrDepthLimit(limit);
          const rawDepth = await this.fetchTrOpenJson<{
            data?: { lastUpdateId?: number; bids?: unknown; asks?: unknown };
          }>("/open/v1/market/depth", {
            symbol: trSymbol,
            limit: depthLimit,
          });
          const payload = (rawDepth.data ?? rawDepth) as {
            lastUpdateId?: number;
            bids?: unknown;
            asks?: unknown;
          };
          const bids = this.normalizeDepthSide(payload.bids);
          const asks = this.normalizeDepthSide(payload.asks);
          if (bids.length > 0 && asks.length > 0) {
            return {
              lastUpdateId: Number(payload.lastUpdateId ?? Date.now()),
              bids: bids.slice(0, limit).map((b) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
              asks: asks.slice(0, limit).map((a) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
            };
          }
        } catch {
          // fallback below
        }
        return this.fallbackOrderBook(normalized, limit);
      }
    }
    if (this.isGlobalCooldownActive()) {
      this.maybeLogCooldown("getOrderBook");
      return this.fallbackOrderBook(normalized, limit);
    }
    if (this.isGlobalNetworkCooldownActive()) {
      this.maybeLogNetworkCooldown("getOrderBook");
      return this.fallbackOrderBook(normalized, limit);
    }
    try {
      const client = this.ensureClient("getOrderBook");
      return await this.call("getOrderBook", async () => {
        const orderBook = (await client.book({ symbol: normalized })) as unknown as Record<string, unknown>;
        const bids = this.normalizeDepthSide(orderBook.bids);
        const asks = this.normalizeDepthSide(orderBook.asks);
        if (bids.length === 0 || asks.length === 0) {
          throw new Error("OrderBook response malformed: bids/asks missing");
        }
        return {
          lastUpdateId: Number(orderBook.lastUpdateId ?? Date.now()),
          bids: bids.slice(0, limit).map((b) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
          asks: asks.slice(0, limit).map((a) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
        };
      });
    } catch (error) {
      this.markGlobalBanFromError(error);
      this.markNetworkIssueFromError(error);
      if (this.isGlobalCooldownActive()) {
        this.maybeLogCooldown("getOrderBook");
        return this.fallbackOrderBook(normalized, limit);
      }
      if (this.isGlobalNetworkCooldownActive()) {
        this.maybeLogNetworkCooldown("getOrderBook");
        return this.fallbackOrderBook(normalized, limit);
      }
      try {
        const rawDepth = await this.fetchPublicJson<{
          lastUpdateId?: number;
          bids?: unknown;
          asks?: unknown;
          data?: { lastUpdateId?: number; bids?: unknown; asks?: unknown };
          result?: { lastUpdateId?: number; bids?: unknown; asks?: unknown };
        }>(
          "/api/v3/depth",
          { symbol: normalized, limit: Math.min(limit, 100) },
          TR_MARKETDATA_TIMEOUT_MS,
        );
        const payload = rawDepth.data ?? rawDepth.result ?? rawDepth;
        const bids = this.normalizeDepthSide(payload.bids);
        const asks = this.normalizeDepthSide(payload.asks);
        if (bids.length === 0 || asks.length === 0) return this.fallbackOrderBook(normalized, limit);
        return {
          lastUpdateId: Number(payload.lastUpdateId ?? Date.now()),
          bids: bids.slice(0, limit).map((b) => ({ price: Number(b[0]), quantity: Number(b[1]) })),
          asks: asks.slice(0, limit).map((a) => ({ price: Number(a[0]), quantity: Number(a[1]) })),
        };
      } catch {
        return this.fallbackOrderBook(normalized, limit);
      }
    }
  }

  async getRecentTrades(symbol: string, limit = 50): Promise<RecentTrade[]> {
    const normalized = symbol.toUpperCase();
    if (this.platform === "tr") {
      try {
        const rawRows = await this.fetchPublicJson<unknown>(
          "/api/v3/trades",
          { symbol: normalized, limit: Math.min(limit, 200) },
          TR_MARKETDATA_TIMEOUT_MS,
        );
        const rows = this.pickArray<Record<string, unknown>>(rawRows);
        if (rows.length === 0) return this.fallbackRecentTrades(normalized, limit);
        return rows.map((x) => ({
          id: Number(x.id ?? Date.now()),
          price: Number(x.price ?? 0),
          qty: Number(x.qty ?? x.quantity ?? 0),
          time: Number(x.time ?? Date.now()),
          isBuyerMaker: Boolean(x.isBuyerMaker ?? false),
        }));
      } catch (error) {
        this.markGlobalBanFromError(error);
        this.markNetworkIssueFromError(error);
        try {
          const trSymbol = this.toTrOpenSymbol(normalized);
          const rawRows = await this.fetchTrOpenJson<{
            data?: { list?: Array<Record<string, unknown>> };
          }>("/open/v1/market/trades", {
            symbol: trSymbol,
            limit: Math.min(limit, 200),
          });
          const rows = this.pickArray<Record<string, unknown>>(rawRows);
          if (rows.length > 0) {
            return rows.map((x, index) => ({
              id: Number(x.id ?? x.tradeId ?? Date.now() + index),
              price: Number(x.price ?? 0),
              qty: Number(x.qty ?? x.quantity ?? x.amount ?? 0),
              time: Number(x.time ?? x.ts ?? Date.now()),
              isBuyerMaker: Boolean(x.isBuyerMaker ?? false),
            }));
          }
        } catch {
          // fallback below
        }
        return this.fallbackRecentTrades(normalized, limit);
      }
    }
    if (this.isGlobalCooldownActive()) {
      this.maybeLogCooldown("getRecentTrades");
      return this.fallbackRecentTrades(normalized, limit);
    }
    if (this.isGlobalNetworkCooldownActive()) {
      this.maybeLogNetworkCooldown("getRecentTrades");
      return this.fallbackRecentTrades(normalized, limit);
    }
    try {
      const client = this.ensureClient("getRecentTrades");
      return await this.call("getRecentTrades", async () => {
        const raw = await client.trades({ symbol: normalized });
        const rows = this.pickArray<Record<string, string | number | boolean | undefined>>(raw);
        if (rows.length === 0) {
          return this.fallbackRecentTrades(normalized, limit);
        }
        return rows.slice(0, limit).map((x, index) => {
          const row = x as Record<string, string | number | boolean | undefined>;
          return {
            id: Number(row.id ?? row.tradeId ?? Date.now() + index),
            price: Number(row.price ?? 0),
            qty: Number(row.quantity ?? row.qty ?? 0),
            quoteQty: Number(row.quoteQty ?? 0),
            time: Number(row.time ?? Date.now()),
            isBuyerMaker: Boolean(row.isBuyerMaker ?? false),
          };
        });
      });
    } catch (error) {
      this.markGlobalBanFromError(error);
      this.markNetworkIssueFromError(error);
      if (this.isGlobalCooldownActive()) {
        this.maybeLogCooldown("getRecentTrades");
        return this.fallbackRecentTrades(normalized, limit);
      }
      if (this.isGlobalNetworkCooldownActive()) {
        this.maybeLogNetworkCooldown("getRecentTrades");
        return this.fallbackRecentTrades(normalized, limit);
      }
      try {
        const rawRows = await this.fetchPublicJson<unknown>(
          "/api/v3/trades",
          { symbol: normalized, limit: Math.min(limit, 200) },
          TR_MARKETDATA_TIMEOUT_MS,
        );
        const rows = this.pickArray<Record<string, unknown>>(rawRows);
        if (rows.length === 0) return this.fallbackRecentTrades(normalized, limit);
        return rows.map((x) => ({
          id: Number(x.id ?? Date.now()),
          price: Number(x.price ?? 0),
          qty: Number(x.qty ?? x.quantity ?? 0),
          time: Number(x.time ?? Date.now()),
          isBuyerMaker: Boolean(x.isBuyerMaker ?? false),
        }));
      } catch {
        return this.fallbackRecentTrades(normalized, limit);
      }
    }
  }

  private async internalPlaceOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const symbol = req.symbol.toUpperCase();
    const shouldDryRun = req.dryRun ?? this.dryRun;

    const validQty = await this.calculateValidQuantity(symbol, req.quantity);
    const symbolValidation = await this.validateSymbolFilters(symbol, validQty, req.price);
    if (!symbolValidation.ok) {
      throw new Error(`Order validation failed: ${symbolValidation.reasons.join(", ")}`);
    }

    logger.info(
      {
        symbol,
        side: req.side,
        type: req.type,
        quantity: validQty,
        quoteOrderQty: req.quoteOrderQty,
        dryRun: shouldDryRun,
      },
      "Order submit requested",
    );

    if (shouldDryRun || !this.client) {
      return {
        orderId: `dry-${randomUUID()}`,
        clientOrderId: `sim-${Date.now()}`,
        symbol,
        status: "SIMULATED",
        side: req.side,
        type: req.type,
        executedQty: validQty,
        price: req.price,
        dryRun: true,
        metadata: { simulation: true, environment: this.environment },
      };
    }

    if (this.platform === "tr" && this.environment === "live") {
      const trResponse = await this.call("trPlaceOrder", async () =>
        this.fetchTrSignedJson<Record<string, unknown>>("POST", "/open/v1/orders", {
          symbol: this.toTrOrderSymbol(symbol),
          side: this.mapOrderSideToTr(req.side),
          type: this.mapOrderTypeToTr(req.type),
          quantity:
            req.type === "MARKET" && req.side === "BUY" && typeof req.quoteOrderQty === "number" && req.quoteOrderQty > 0
              ? undefined
              : validQty.toFixed(8),
          quoteOrderQty:
            req.type === "MARKET" && req.side === "BUY" && typeof req.quoteOrderQty === "number" && req.quoteOrderQty > 0
              ? Number(req.quoteOrderQty.toFixed(8))
              : undefined,
          price: req.type === "LIMIT" ? Number(req.price ?? 0).toFixed(8) : undefined,
          timeInForce: req.type === "LIMIT" ? this.mapTimeInForceToTr(req.timeInForce) : undefined,
        }),
      );
      const orderId = String(
        trResponse.orderId ??
          trResponse.order_id ??
          trResponse.orderNo ??
          trResponse.order_no ??
          trResponse.id ??
          "",
      );
      return {
        orderId,
        clientOrderId: String(
          trResponse.clientId ??
            trResponse.clientOrderId ??
            trResponse.client_order_id ??
            "",
        ),
        symbol,
        status: this.mapTrOrderStatus(trResponse.status),
        side: req.side,
        type: req.type,
        executedQty: Number(trResponse.executedQty ?? trResponse.executed_quantity ?? 0),
        price: Number(trResponse.price ?? req.price ?? 0),
        dryRun: false,
        metadata: { raw: trResponse },
      };
    }

    const client = this.ensureClient("internalPlaceOrder");
    const payload =
      req.type === "MARKET"
        ? {
            symbol,
            side: req.side,
            type: "MARKET" as const,
            ...(typeof req.quoteOrderQty === "number" && req.quoteOrderQty > 0
              ? { quoteOrderQty: Number(req.quoteOrderQty.toFixed(8)) }
              : { quantity: validQty }),
          }
        : {
            symbol,
            side: req.side,
            type: "LIMIT" as const,
            quantity: validQty,
            price: req.price!,
            timeInForce: req.timeInForce ?? "GTC",
          };

    let response: unknown = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await this.call("placeOrder", async () => client.order(payload as never));
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const message = (error as Error)?.message?.toLowerCase?.() ?? "";
        const isRateLimited = message.includes("http 429") || message.includes("too many requests");
        if (!isRateLimited || attempt >= 2) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
    if (!response) {
      throw (lastError as Error) ?? new Error("placeOrder failed");
    }
    const orderResponse = this.pickOrderPayload(response);
    const orderId = String(orderResponse.orderId ?? orderResponse.order_id ?? orderResponse.id ?? "");
    const status = String(orderResponse.status ?? orderResponse.orderStatus ?? "NEW");
    const executedQty = Number(
      orderResponse.executedQty ??
      orderResponse.executed_quantity ??
      orderResponse.executedQuantity ??
      orderResponse.cumQty ??
      0,
    );
    return {
      orderId,
      clientOrderId: String(orderResponse.clientOrderId ?? orderResponse.client_order_id ?? ""),
      symbol,
      status: executedQty > 0 && status === "NEW" ? "FILLED" : status,
      side: req.side,
      type: req.type,
      executedQty,
      price: Number(orderResponse.price ?? req.price ?? 0),
      dryRun: false,
      metadata: { transactTime: orderResponse.transactTime, rawStatus: orderResponse.status },
    };
  }

  async placeMarketBuy(symbol: string, quantity: number, dryRun?: boolean) {
    return this.internalPlaceOrder({ symbol, side: "BUY", type: "MARKET", quantity, dryRun });
  }
  async placeMarketBuyByQuote(symbol: string, quoteOrderQty: number, dryRun?: boolean) {
    return this.internalPlaceOrder({
      symbol,
      side: "BUY",
      type: "MARKET",
      quantity: Math.max(quoteOrderQty, 0.00000001),
      quoteOrderQty,
      dryRun,
    });
  }
  async placeMarketSell(symbol: string, quantity: number, dryRun?: boolean) {
    return this.internalPlaceOrder({ symbol, side: "SELL", type: "MARKET", quantity, dryRun });
  }
  async placeLimitBuy(symbol: string, quantity: number, price: number, dryRun?: boolean) {
    return this.internalPlaceOrder({ symbol, side: "BUY", type: "LIMIT", quantity, price, dryRun });
  }
  async placeLimitSell(symbol: string, quantity: number, price: number, dryRun?: boolean) {
    return this.internalPlaceOrder({ symbol, side: "SELL", type: "LIMIT", quantity, price, dryRun });
  }

  async cancelOrder(symbol: string, orderId: string) {
    const normalized = symbol.toUpperCase();
    if (this.platform === "tr" && this.environment === "live") {
      const payload = await this.call("trCancelOrder", async () =>
        this.fetchTrSignedJson<Record<string, unknown>>("POST", "/open/v1/orders/cancel", {
          orderId,
        }),
      );
      return {
        symbol: normalized,
        orderId: String(payload.orderId ?? payload.order_id ?? orderId),
        status: this.mapTrOrderStatus(payload.status),
      };
    }
    if (this.dryRun || !this.client) {
      return { symbol: normalized, orderId, status: "CANCELED_SIMULATED" };
    }
    const client = this.ensureClient("cancelOrder");
    const result = await this.call("cancelOrder", async () => client.cancelOrder({ symbol: normalized, orderId: Number(orderId) }));
    const payload = this.pickOrderPayload(result);
    return {
      symbol: normalized,
      orderId: String(payload.orderId ?? payload.order_id ?? orderId),
      status: String(payload.status ?? payload.orderStatus ?? "CANCELED"),
    };
  }

  async getOrderStatus(symbol: string, orderId: string) {
    const normalized = symbol.toUpperCase();
    if (this.platform === "tr" && this.environment === "live") {
      const payload = await this.call("trGetOrderStatus", async () =>
        this.fetchTrSignedJson<Record<string, unknown>>("GET", "/open/v1/orders/detail", {
          orderId,
        }),
      );
      return {
        ...payload,
        orderId: payload.orderId ?? payload.order_id ?? orderId,
        status: this.mapTrOrderStatus(payload.status),
      };
    }
    if (this.dryRun || !this.client) {
      return { symbol: normalized, orderId, status: "SIMULATED", updatedAt: new Date().toISOString() };
    }
    const client = this.ensureClient("getOrderStatus");
    const result = await this.call("getOrderStatus", async () => client.getOrder({ symbol: normalized, orderId: Number(orderId) }));
    const payload = this.pickOrderPayload(result);
    return { ...payload, orderId: payload.orderId ?? payload.order_id ?? orderId };
  }

  async getExchangeInfo(): Promise<ExchangeInfoResponse> {
    const isFresh = this.cachedExchangeInfo && Date.now() - this.cacheAt < 60_000;
    if (isFresh) return this.cachedExchangeInfo as ExchangeInfoResponse;
    // If exchange is in temporary cooldown, use stale cache instead of failing execution flow.
    if ((this.isGlobalCooldownActive() || this.isGlobalNetworkCooldownActive()) && this.cachedExchangeInfo) {
      return this.cachedExchangeInfo;
    }

    if (!this.client) {
      const fallback: ExchangeInfoResponse = {
        timezone: "UTC",
        serverTime: Date.now(),
        symbols: [
          {
            symbol: "BTCUSDT",
            status: "TRADING",
            baseAsset: "BTC",
            quoteAsset: "USDT",
            filters: {
              LOT_SIZE: { minQty: "0.0001", maxQty: "1000", stepSize: "0.0001" },
              MIN_NOTIONAL: { minNotional: "10" },
              PRICE_FILTER: { minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" },
            },
          },
        ],
      };
      this.cachedExchangeInfo = fallback;
      this.cacheAt = Date.now();
      return fallback;
    }

    if (this.platform === "tr") {
      type TrSymbol = {
        symbol?: string;
        baseAsset?: string;
        quoteAsset?: string;
        spotTradingEnable?: number;
        filters?: Array<Record<string, string>>;
      };
      try {
        const trData = await this.fetchTrOpenJson<{ list?: TrSymbol[] }>("/open/v1/common/symbols");
        const symbols: ExchangeSymbolInfo[] = (trData.list ?? []).map((sym) => {
          const filters: Record<string, Record<string, string>> = {};
          for (const filter of sym.filters ?? []) {
            const filterType = String(filter.filterType);
            filters[filterType] = filter;
            if (filterType === "NOTIONAL" && !filters.MIN_NOTIONAL) {
              filters.MIN_NOTIONAL = {
                minNotional: String(filter.minNotional ?? "0"),
              };
            }
          }
          return {
            symbol: String(sym.symbol ?? "").replace(/_/g, "").toUpperCase(),
            status: Number(sym.spotTradingEnable ?? 1) === 1 ? "TRADING" : "BREAK",
            baseAsset: String(sym.baseAsset ?? "").toUpperCase(),
            quoteAsset: String(sym.quoteAsset ?? "").toUpperCase(),
            filters,
          };
        });
        this.cachedExchangeInfo = {
          timezone: "Europe/Istanbul",
          serverTime: Date.now(),
          symbols: symbols.filter((row) => row.symbol && row.baseAsset && row.quoteAsset),
        };
        this.cacheAt = Date.now();
        return this.cachedExchangeInfo;
      } catch (error) {
        if (this.shouldLogWarn("tr-open-symbols-fallback", 15_000)) {
          logger.warn({ error: (error as Error).message }, "TR open symbols failed, falling back to MBX exchangeInfo");
        }
      }
    }

    const client = this.ensureClient("getExchangeInfo");
    let raw: {
      timezone: string;
      serverTime: number;
      symbols: Array<Record<string, unknown>>;
    };
    try {
      raw = (await this.call("getExchangeInfo", async () => client.exchangeInfo())) as unknown as {
        timezone: string;
        serverTime: number;
        symbols: Array<Record<string, unknown>>;
      };
    } catch {
      try {
        raw = (await this.fetchPublicJson("/api/v3/exchangeInfo")) as {
          timezone: string;
          serverTime: number;
          symbols: Array<Record<string, unknown>>;
        };
      } catch (error) {
        if (this.cachedExchangeInfo) {
          if (this.shouldLogWarn("exchange-info-stale-cache", 10_000)) {
            logger.warn(
              { error: (error as Error).message, ageMs: Date.now() - this.cacheAt },
              "Using stale exchangeInfo cache due to upstream cooldown/error",
            );
          }
          return this.cachedExchangeInfo;
        }
        throw error;
      }
    }
    const symbols: ExchangeSymbolInfo[] = raw.symbols.map((sym: Record<string, unknown>) => {
      const filters: Record<string, Record<string, string>> = {};
      for (const filter of (sym.filters as Array<Record<string, string>>) ?? []) {
        const filterType = String(filter.filterType);
        filters[filterType] = filter;
      }
      return {
        symbol: String(sym.symbol ?? ""),
        status: String(sym.status ?? ""),
        baseAsset: String(sym.baseAsset ?? ""),
        quoteAsset: String(sym.quoteAsset ?? ""),
        filters,
      };
    });
    this.cachedExchangeInfo = { timezone: raw.timezone, serverTime: raw.serverTime, symbols };
    this.cacheAt = Date.now();
    return this.cachedExchangeInfo;
  }

  async validateSymbolFilters(symbol: string, quantity: number, price?: number): Promise<SymbolValidationResult> {
    const reasons: string[] = [];
    const info = await this.getExchangeInfo();
    const found = info.symbols.find((s) => s.symbol === symbol.toUpperCase());
    if (!found) {
      return { ok: false, reasons: ["Symbol not found in exchange info"] };
    }

    const lot = found.filters.LOT_SIZE;
    const notional = found.filters.MIN_NOTIONAL;
    const priceFilter = found.filters.PRICE_FILTER;
    let adjustedQuantity = quantity;
    let adjustedPrice = price;

    if (lot) {
      const minQty = Number(lot.minQty ?? 0);
      const maxQty = Number(lot.maxQty ?? Number.MAX_SAFE_INTEGER);
      const stepSize = Number(lot.stepSize ?? 0.0001);
      adjustedQuantity = Math.max(minQty, Math.min(quantity, maxQty));
      adjustedQuantity = Number((Math.floor(adjustedQuantity / stepSize) * stepSize).toFixed(8));
      if (adjustedQuantity <= 0) {
        reasons.push("Invalid quantity after LOT_SIZE adjustments");
      }
    }

    if (priceFilter && adjustedPrice) {
      const tickSize = Number(priceFilter.tickSize ?? 0.01);
      adjustedPrice = Number((Math.floor(adjustedPrice / tickSize) * tickSize).toFixed(8));
    }

    if (notional) {
      const minNotional = Number(notional.minNotional ?? 0);
      const effectivePrice = adjustedPrice ?? (await this.getTicker(symbol)).price;
      if (adjustedQuantity * effectivePrice < minNotional) {
        reasons.push(`Notional below min: ${minNotional}`);
      }
      return {
        ok: reasons.length === 0,
        reasons,
        adjustedQuantity,
        adjustedPrice,
        minNotional,
      };
    }

    return {
      ok: reasons.length === 0,
      reasons,
      adjustedQuantity,
      adjustedPrice,
    };
  }

  async calculateValidQuantity(symbol: string, quantity: number): Promise<number> {
    const validation = await this.validateSymbolFilters(symbol.toUpperCase(), quantity);
    if (!validation.ok || !validation.adjustedQuantity) {
      throw new Error(`calculateValidQuantity failed: ${validation.reasons.join(", ")}`);
    }
    return validation.adjustedQuantity;
  }

  async estimateFees(symbol: string, side: "BUY" | "SELL", quantity: number, price: number): Promise<FeeEstimate> {
    const notional = quantity * price;
    const takerFeeRate = env.BINANCE_TAKER_FEE_RATE ?? 0.001;
    const makerFeeRate = env.BINANCE_MAKER_FEE_RATE ?? 0.0009;
    return {
      symbol: symbol.toUpperCase(),
      side,
      quantity,
      price,
      takerFeeRate,
      makerFeeRate,
      estimatedTakerFee: Number((notional * takerFeeRate).toFixed(8)),
      estimatedMakerFee: Number((notional * makerFeeRate).toFixed(8)),
    };
  }

  private async getTrAccountBalances(): Promise<ExchangeBalance[]> {
    const warmCache = this.getCachedBalances();
    if (warmCache && Date.now() - this.lastKnownBalancesAt < 30_000) {
      return warmCache;
    }
    if (this.isGlobalCooldownActive() || this.isGlobalNetworkCooldownActive()) {
      const cached = this.getCachedBalances();
      if (cached) return cached;
    }
    if (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET) {
      throw new Error("Binance API key/secret not configured");
    }
    const trBase = env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "");
    const endpointPlans = [{ base: trBase, paths: ["/open/v1/account/spot"] }];
    let lastError: Error | null = null;

    for (const plan of endpointPlans) {
      for (const path of plan.paths) {
        const base = plan.base;
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}&recvWindow=5000`;
        const signature = createHmac("sha256", env.BINANCE_API_SECRET).update(query).digest("hex");
        const url = `${base}${path}?${query}&signature=${signature}`;
        try {
          const response = await fetch(url, {
            method: "GET",
            headers: {
              "X-MBX-APIKEY": env.BINANCE_API_KEY,
              Accept: "application/json",
            },
          });
          if (!response.ok) {
            const bodyText = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status} @ ${base}${path} ${bodyText}`.trim());
          }
          const json = (await response.json()) as {
            code?: number;
            msg?: string;
            data?: {
              accountAssets?: Array<{ asset?: string; free?: string | number; locked?: string | number }>;
              balances?: Array<{ asset?: string; free?: string | number; locked?: string | number }>;
            };
            balances?: Array<{ asset?: string; free?: string | number; locked?: string | number }>;
          };
          if ((json.code ?? 0) !== 0) {
            throw new Error(`TR API code=${json.code ?? "unknown"} msg=${json.msg ?? "unknown"} @ ${base}${path}`);
          }
          const balances = json.data?.accountAssets ?? json.data?.balances ?? json.balances ?? [];
          const mapped = balances
            .map((row) => {
              const free = Number(row.free ?? 0);
              const locked = Number(row.locked ?? 0);
              return {
                asset: String(row.asset ?? ""),
                free,
                locked,
                total: Number((free + locked).toFixed(8)),
              };
            })
            .filter((row) => row.asset);
          this.lastKnownBalances = mapped;
          this.lastKnownBalancesAt = Date.now();
          return mapped;
        } catch (error) {
          lastError = error as Error;
        }
      }
    }

    const cached = this.getCachedBalances();
    if (cached) {
      if (this.shouldLogWarn("balance-cache-fallback", 15_000)) {
        logger.warn(
          { ageMs: Date.now() - this.lastKnownBalancesAt, error: (lastError as Error)?.message },
          "Using cached account balances due to upstream error",
        );
      }
      return cached;
    }
    throw lastError ?? new Error("Binance TR account endpoint failed");
  }

  async getAccountBalances(): Promise<ExchangeBalance[]> {
    if (this.platform === "tr" && this.environment === "live") {
      return this.getTrAccountBalances();
    }
    if (this.isGlobalCooldownActive() || this.isGlobalNetworkCooldownActive()) {
      const cached = this.getCachedBalances();
      if (cached) return cached;
    }
    const client = this.ensureClient("getAccountBalances");
    const info = await this.call("getAccountBalances", async () => client.accountInfo());
    const balances = (info.balances ?? []) as Array<{ asset: string; free: string; locked: string }>;
    const mapped = balances.map((row) => {
      const free = Number(row.free ?? 0);
      const locked = Number(row.locked ?? 0);
      return {
        asset: row.asset,
        free,
        locked,
        total: Number((free + locked).toFixed(8)),
      };
    });
    this.lastKnownBalances = mapped;
    this.lastKnownBalancesAt = Date.now();
    return mapped;
  }

  subscribeTicker(symbol: string, onData: (data: { symbol: string; price: number; eventTime: number }) => void) {
    const normalized = symbol.toUpperCase();
    if (this.client) {
      const clean = this.client.ws.ticker(normalized, (data) => {
        onData({
          symbol: data.symbol,
          price: Number(data.curDayClose),
          eventTime: data.eventTime ?? Date.now(),
        });
      });
      return () => clean();
    }

    const interval = setInterval(async () => {
      const ticker = await this.getTicker(normalized);
      onData({ symbol: normalized, price: ticker.price, eventTime: Date.now() });
    }, 2000);
    return () => clearInterval(interval);
  }
}
