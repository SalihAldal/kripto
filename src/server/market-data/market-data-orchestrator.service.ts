import type { MarketTicker } from "@/lib/types";
import { getExchangeProvider } from "@/src/server/exchange";
import { putMarketSnapshot, getMarketSnapshot } from "@/src/server/scanner/market-snapshot-cache";
import type {
  ExchangeInfoResponse,
  KlineItem,
  OrderBookSnapshot,
  RecentTrade,
} from "@/src/types/exchange";
import type {
  MarketContextBundle,
  MarketDataKind,
  MarketDataPriority,
  MarketDataReadOptions,
  MarketDataTelemetry,
  MarketDataTicker,
} from "@/src/server/market-data/market-data.types";
import {
  MARKET_DATA_RATE_BUDGET_CODE,
  MarketDataUnavailableError,
} from "@/src/server/market-data/market-data-unavailable.error";
import { recordPublicMarketRestCall } from "@/src/server/market-data/spine/rest-call-audit";
import { getSharedRestLimiter } from "@/src/server/market-data/spine/shared-rest-limiter";

const WEIGHT_ESTIMATE: Record<MarketDataKind, number> = {
  ticker: 2,
  klines: 1,
  orderBook: 5,
  recentTrades: 5,
  exchangeInfo: 10,
  contextBundle: 0,
};

const WEIGHT_BUDGET_PER_MINUTE = 5_500;
const BACKOFF_INITIAL_MS = 3_000;
const BACKOFF_MAX_MS = 120_000;
const EXCHANGE_CALL_TIMEOUT_MS = 20_000;

type CacheRow<T> = { value: T; at: number; volume24h?: number };

const tickerCache = new Map<string, CacheRow<MarketDataTicker>>();
const klinesCache = new Map<string, CacheRow<KlineItem[]>>();
const orderBookCache = new Map<string, CacheRow<OrderBookSnapshot>>();
const recentTradesCache = new Map<string, CacheRow<RecentTrade[]>>();
let exchangeInfoCache: CacheRow<ExchangeInfoResponse> | null = null;

const inFlight = new Map<string, Promise<unknown>>();
const weightWindow: number[] = [];
const latencySamples: number[] = [];

let telemetry = createEmptyTelemetry();
let backoffUntil = 0;
let backoffMs = 0;
let last429At = 0;

function createEmptyTelemetry(): MarketDataTelemetry {
  return {
    totalRequests: 0,
    cacheHits: 0,
    coalescedHits: 0,
    duplicateAvoided: 0,
    exchangeCalls: 0,
    estimatedWeight: 0,
    rateLimited429: 0,
    backoffActive: false,
    backoffUntil: null,
    cacheHitRatio: 0,
    averageLatencyMs: 0,
    requestsByKind: {},
  };
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function recordKind(kind: MarketDataKind) {
  telemetry.requestsByKind[kind] = (telemetry.requestsByKind[kind] ?? 0) + 1;
}

function resolveVolumeTier(volume24h: number) {
  if (volume24h >= 5_000_000) return "high" as const;
  if (volume24h >= 800_000) return "medium" as const;
  return "low" as const;
}

export function resolveAdaptiveTtlMs(input: {
  kind: MarketDataKind;
  volume24h?: number;
  priority?: MarketDataPriority;
  interval?: string;
}) {
  const priority = input.priority ?? "normal";
  const tier = resolveVolumeTier(input.volume24h ?? 0);
  const priorityFactor =
    priority === "critical" ? 0.55 : priority === "high" ? 0.75 : priority === "ui" ? 1.35 : 1;
  const tierMs =
    tier === "high"
      ? { ticker: 4_000, klines: 15_000, orderBook: 5_000, recentTrades: 6_000, exchangeInfo: 120_000 }
      : tier === "medium"
        ? { ticker: 8_000, klines: 25_000, orderBook: 10_000, recentTrades: 12_000, exchangeInfo: 180_000 }
        : { ticker: 15_000, klines: 45_000, orderBook: 20_000, recentTrades: 25_000, exchangeInfo: 300_000 };
  if (input.kind === "klines" && input.interval === "1h") {
    return round(Math.max(30_000, tierMs.klines * 2.2 * priorityFactor));
  }
  if (input.kind === "contextBundle") {
    return round(Math.min(tierMs.ticker, tierMs.klines) * priorityFactor);
  }
  const base = tierMs[input.kind === "contextBundle" ? "ticker" : input.kind] ?? 10_000;
  return round(base * priorityFactor);
}

function trimWeightWindow(now: number) {
  while (weightWindow.length > 0 && now - weightWindow[0] > 60_000) {
    weightWindow.shift();
  }
}

function currentWeightUsage(now = Date.now()) {
  trimWeightWindow(now);
  return weightWindow.length;
}

function canSpendWeight(kind: MarketDataKind, _priority: MarketDataPriority) {
  if (isBackoffActive()) return false;
  const usage = currentWeightUsage();
  const estimate = WEIGHT_ESTIMATE[kind];
  return usage + estimate <= WEIGHT_BUDGET_PER_MINUTE;
}

export function canSpendMarketDataWeight(kind: MarketDataKind, priority: MarketDataPriority = "normal") {
  return canSpendWeight(kind, priority);
}

function spendWeight(kind: MarketDataKind) {
  const now = Date.now();
  trimWeightWindow(now);
  const w = WEIGHT_ESTIMATE[kind];
  for (let i = 0; i < w; i += 1) weightWindow.push(now);
  telemetry.estimatedWeight = currentWeightUsage(now);
}

function parseRetryAfterMs(message: string) {
  const match = message.match(/retry[- ]?after[^0-9]*(\d+)/i);
  if (match?.[1]) return Number(match[1]) * 1000;
  return 0;
}

function is429Error(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("http 429") || message.includes("too much request weight") || message.includes("too many requests");
}

function is418Error(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("http 418") || message.includes("ip banned") || message.includes("banned until");
}

function register429(error: unknown) {
  telemetry.rateLimited429 += 1;
  last429At = Date.now();
  const retryMs = parseRetryAfterMs((error as Error)?.message ?? "");
  const base = retryMs > 0 ? retryMs : Math.max(BACKOFF_INITIAL_MS, backoffMs * 2 || BACKOFF_INITIAL_MS);
  const jitter = Math.floor(Math.random() * Math.max(250, base * 0.25));
  backoffMs = Math.min(base + jitter, BACKOFF_MAX_MS);
  backoffUntil = Date.now() + backoffMs;
  void getSharedRestLimiter().register429({ retryAfterMs: retryMs });
}

function register418(error: unknown) {
  const retryMs = parseRetryAfterMs((error as Error)?.message ?? "");
  const banMatch = (error as Error)?.message?.match(/\b(\d{13})\b/);
  const banUntil = banMatch?.[1] ? Number(banMatch[1]) : undefined;
  void getSharedRestLimiter().register418({ retryAfterMs: retryMs, banUntil });
  backoffUntil = Math.max(backoffUntil, banUntil && banUntil > Date.now() ? banUntil : Date.now() + 15 * 60_000);
}

function clearBackoffOnSuccess() {
  if (Date.now() - last429At > 30_000) {
    backoffMs = 0;
    backoffUntil = 0;
  }
}

function isBackoffActive() {
  return Date.now() < backoffUntil;
}

function readCache<T>(map: Map<string, CacheRow<T>>, key: string, maxAgeMs: number) {
  const row = map.get(key);
  if (!row) return null;
  if (Date.now() - row.at > maxAgeMs) return null;
  return row.value;
}

function writeCache<T>(map: Map<string, CacheRow<T>>, key: string, value: T, volume24h?: number) {
  map.set(key, { value, at: Date.now(), volume24h });
}

async function coalesce<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) {
    telemetry.coalescedHits += 1;
    return existing as Promise<T>;
  }
  const promise = factory().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

function waitForAbort(signal?: AbortSignal): Promise<never> | null {
  if (!signal) return null;
  if (signal.aborted) {
    return Promise.reject(new Error(String(signal.reason ?? "Aborted")));
  }
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error(String(signal.reason ?? "Aborted"))), {
      once: true,
    });
  });
}

async function fetchFromExchange<T>(
  kind: MarketDataKind,
  fn: () => Promise<T>,
  options?: { signal?: AbortSignal; timeoutMs?: number; label?: string; symbol?: string },
): Promise<T> {
  const started = Date.now();
  const timeoutMs = Math.max(1_000, options?.timeoutMs ?? EXCHANGE_CALL_TIMEOUT_MS);
  recordPublicMarketRestCall({
    kind: kind === "contextBundle" ? "other" : kind,
    source: "MarketDataOrchestrator",
    symbol: options?.symbol,
    recovery: true,
  });
  const budget = await getSharedRestLimiter().canSpend(WEIGHT_ESTIMATE[kind] || 1);
  if (!budget.ok) {
    throw new MarketDataUnavailableError("Market data weight budget exhausted", {
      code: MARKET_DATA_RATE_BUDGET_CODE,
      kind,
    });
  }
  try {
    telemetry.exchangeCalls += 1;
    spendWeight(kind);
    await getSharedRestLimiter().spend(WEIGHT_ESTIMATE[kind] || 1);
    const abortPromise = waitForAbort(options?.signal);
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`${options?.label ?? kind} timeout after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
      ...(abortPromise ? [abortPromise] : []),
    ]);
    clearBackoffOnSuccess();
    latencySamples.push(Date.now() - started);
    if (latencySamples.length > 500) latencySamples.shift();
    telemetry.averageLatencyMs = round(
      latencySamples.reduce((a, b) => a + b, 0) / Math.max(1, latencySamples.length),
    );
    return result;
  } catch (error) {
    if (is429Error(error)) register429(error);
    if (is418Error(error)) register418(error);
    throw error;
  }
}

function updateHitRatio() {
  telemetry.cacheHitRatio = telemetry.totalRequests
    ? round((telemetry.cacheHits / telemetry.totalRequests) * 100)
    : 0;
  telemetry.backoffActive = isBackoffActive();
  telemetry.backoffUntil = backoffUntil > Date.now() ? backoffUntil : null;
}

export class MarketDataOrchestrator {
  async getTicker(symbol: string, options: MarketDataReadOptions = {}): Promise<MarketDataTicker> {
    const normalized = symbol.toUpperCase();
    const priority = options.priority ?? "normal";
    telemetry.totalRequests += 1;
    recordKind("ticker");

    const cachedVolume = tickerCache.get(normalized)?.volume24h;
    const maxAgeMs = options.maxAgeMs ?? resolveAdaptiveTtlMs({ kind: "ticker", volume24h: cachedVolume, priority });
    const cached = readCache(tickerCache, normalized, maxAgeMs);
    if (cached) {
      telemetry.cacheHits += 1;
      updateHitRatio();
      return cached;
    }

    if (isBackoffActive() && options.allowStaleOnBackoff !== false) {
      const stale = tickerCache.get(normalized)?.value;
      if (stale) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
    }

    if (!canSpendWeight("ticker", priority)) {
      const stale = tickerCache.get(normalized)?.value;
      if (stale) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
      throw new MarketDataUnavailableError("Market data weight budget exhausted", {
        code: MARKET_DATA_RATE_BUDGET_CODE,
        symbol: normalized,
        kind: "ticker",
      });
    }

    return coalesce(`ticker:${normalized}`, async () => {
      const freshCached = readCache(tickerCache, normalized, maxAgeMs);
      if (freshCached) {
        telemetry.cacheHits += 1;
        updateHitRatio();
        return freshCached;
      }
      try {
        const provider = getExchangeProvider();
        const row = await fetchFromExchange("ticker", () => provider.getTicker(normalized), {
          signal: options.signal,
          timeoutMs: options.timeoutMs,
          label: `ticker:${normalized}`,
        });
        const mapped: MarketDataTicker = {
          symbol: row.symbol,
          price: row.price,
          change24h: row.change24h,
          volume24h: row.volume24h,
          updatedAt: new Date().toISOString(),
        };
        writeCache(tickerCache, normalized, mapped, mapped.volume24h);
        updateHitRatio();
        return mapped;
      } catch (error) {
        const stale = tickerCache.get(normalized)?.value;
        if (is429Error(error) && stale) {
          telemetry.duplicateAvoided += 1;
          telemetry.cacheHits += 1;
          updateHitRatio();
          return stale;
        }
        throw error;
      }
    });
  }

  async getKlines(
    symbol: string,
    interval = "1m",
    limit = 100,
    options: MarketDataReadOptions = {},
  ): Promise<KlineItem[]> {
    const normalized = symbol.toUpperCase();
    const key = `${normalized}:${interval}:${limit}`;
    const priority = options.priority ?? "normal";
    telemetry.totalRequests += 1;
    recordKind("klines");

    const cachedVolume = tickerCache.get(normalized)?.volume24h;
    const maxAgeMs =
      options.maxAgeMs ?? resolveAdaptiveTtlMs({ kind: "klines", volume24h: cachedVolume, priority, interval });
    const cached = readCache(klinesCache, key, maxAgeMs);
    if (cached) {
      telemetry.cacheHits += 1;
      updateHitRatio();
      return cached;
    }

    if (isBackoffActive()) {
      const stale = klinesCache.get(key)?.value;
      if (stale?.length) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
    }

    if (!canSpendWeight("klines", priority)) {
      const stale = klinesCache.get(key)?.value;
      if (stale?.length) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
      throw new MarketDataUnavailableError("Market data weight budget exhausted", {
        code: MARKET_DATA_RATE_BUDGET_CODE,
        symbol: normalized,
        kind: "klines",
      });
    }

    return coalesce(`klines:${key}`, async () => {
      const freshCached = readCache(klinesCache, key, maxAgeMs);
      if (freshCached) {
        telemetry.cacheHits += 1;
        updateHitRatio();
        return freshCached;
      }
      const provider = getExchangeProvider();
      const rows = await fetchFromExchange("klines", () => provider.getKlines(normalized, interval, limit), {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        label: `klines:${normalized}:${interval}`,
      });
      writeCache(klinesCache, key, rows, cachedVolume);
      updateHitRatio();
      return rows;
    });
  }

  async getOrderBook(symbol: string, limit = 50, options: MarketDataReadOptions = {}): Promise<OrderBookSnapshot> {
    const normalized = symbol.toUpperCase();
    const key = `${normalized}:${limit}`;
    const priority = options.priority ?? "normal";
    telemetry.totalRequests += 1;
    recordKind("orderBook");

    const snapshot = getMarketSnapshot(normalized);
    if (snapshot && snapshot.orderBook.bids.length > 0) {
      const snapshotAge = Date.now() - snapshot.at;
      const maxAgeMs = options.maxAgeMs ?? resolveAdaptiveTtlMs({
        kind: "orderBook",
        volume24h: tickerCache.get(normalized)?.volume24h,
        priority,
      });
      if (snapshotAge <= maxAgeMs) {
        telemetry.cacheHits += 1;
        telemetry.duplicateAvoided += 1;
        updateHitRatio();
        return snapshot.orderBook;
      }
    }

    const cachedVolume = tickerCache.get(normalized)?.volume24h;
    const maxAgeMs =
      options.maxAgeMs ?? resolveAdaptiveTtlMs({ kind: "orderBook", volume24h: cachedVolume, priority });
    const cached = readCache(orderBookCache, key, maxAgeMs);
    if (cached) {
      telemetry.cacheHits += 1;
      updateHitRatio();
      return cached;
    }

    if (isBackoffActive()) {
      const stale = orderBookCache.get(key)?.value ?? snapshot?.orderBook;
      if (stale) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
    }

    if (!canSpendWeight("orderBook", priority)) {
      const stale = orderBookCache.get(key)?.value ?? snapshot?.orderBook;
      if (stale) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
      throw new MarketDataUnavailableError("Market data weight budget exhausted", {
        code: MARKET_DATA_RATE_BUDGET_CODE,
        symbol: normalized,
        kind: "orderBook",
      });
    }

    return coalesce(`orderBook:${key}`, async () => {
      const provider = getExchangeProvider();
      const book = await fetchFromExchange("orderBook", () => provider.getOrderBook(normalized, limit), {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        label: `orderBook:${normalized}`,
      });
      writeCache(orderBookCache, key, book, cachedVolume);
      updateHitRatio();
      return book;
    });
  }

  async getRecentTrades(symbol: string, limit = 50, options: MarketDataReadOptions = {}): Promise<RecentTrade[]> {
    const normalized = symbol.toUpperCase();
    const key = `${normalized}:${limit}`;
    const priority = options.priority ?? "normal";
    telemetry.totalRequests += 1;
    recordKind("recentTrades");

    const snapshot = getMarketSnapshot(normalized);
    if (snapshot?.recentTrades.length) {
      const maxAgeMs = options.maxAgeMs ?? resolveAdaptiveTtlMs({
        kind: "recentTrades",
        volume24h: tickerCache.get(normalized)?.volume24h,
        priority,
      });
      if (Date.now() - snapshot.at <= maxAgeMs) {
        telemetry.cacheHits += 1;
        telemetry.duplicateAvoided += 1;
        updateHitRatio();
        return snapshot.recentTrades;
      }
    }

    const cachedVolume = tickerCache.get(normalized)?.volume24h;
    const maxAgeMs =
      options.maxAgeMs ?? resolveAdaptiveTtlMs({ kind: "recentTrades", volume24h: cachedVolume, priority });
    const cached = readCache(recentTradesCache, key, maxAgeMs);
    if (cached) {
      telemetry.cacheHits += 1;
      updateHitRatio();
      return cached;
    }

    if (isBackoffActive()) {
      const stale = recentTradesCache.get(key)?.value ?? snapshot?.recentTrades;
      if (stale?.length) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
    }

    if (!canSpendWeight("recentTrades", priority)) {
      const stale = recentTradesCache.get(key)?.value ?? snapshot?.recentTrades;
      if (stale?.length) {
        telemetry.duplicateAvoided += 1;
        telemetry.cacheHits += 1;
        updateHitRatio();
        return stale;
      }
      throw new MarketDataUnavailableError("Market data weight budget exhausted", {
        code: MARKET_DATA_RATE_BUDGET_CODE,
        symbol: normalized,
        kind: "recentTrades",
      });
    }

    return coalesce(`recentTrades:${key}`, async () => {
      const provider = getExchangeProvider();
      const rows = await fetchFromExchange("recentTrades", () => provider.getRecentTrades(normalized, limit), {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        label: `recentTrades:${normalized}`,
      });
      writeCache(recentTradesCache, key, rows, cachedVolume);
      updateHitRatio();
      return rows;
    });
  }

  async getExchangeInfo(options: MarketDataReadOptions = {}): Promise<ExchangeInfoResponse> {
    const priority = options.priority ?? "low";
    telemetry.totalRequests += 1;
    recordKind("exchangeInfo");
    const maxAgeMs = options.maxAgeMs ?? resolveAdaptiveTtlMs({ kind: "exchangeInfo", priority });
    if (exchangeInfoCache && Date.now() - exchangeInfoCache.at <= maxAgeMs) {
      telemetry.cacheHits += 1;
      updateHitRatio();
      return exchangeInfoCache.value;
    }
    if (isBackoffActive() && exchangeInfoCache) {
      telemetry.cacheHits += 1;
      updateHitRatio();
      return exchangeInfoCache.value;
    }
    if (!canSpendWeight("exchangeInfo", priority)) {
      if (exchangeInfoCache) {
        telemetry.cacheHits += 1;
        updateHitRatio();
        return exchangeInfoCache.value;
      }
      throw new MarketDataUnavailableError("Market data weight budget exhausted", {
        code: MARKET_DATA_RATE_BUDGET_CODE,
        kind: "exchangeInfo",
      });
    }
    return coalesce("exchangeInfo", async () => {
      if (exchangeInfoCache && Date.now() - exchangeInfoCache.at <= maxAgeMs) {
        telemetry.cacheHits += 1;
        updateHitRatio();
        return exchangeInfoCache.value;
      }
      const provider = getExchangeProvider();
      const info = await fetchFromExchange("exchangeInfo", () => provider.getExchangeInfo(), {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        label: "exchangeInfo",
      });
      exchangeInfoCache = { value: info, at: Date.now() };
      updateHitRatio();
      return info;
    });
  }

  async fetchContextBundle(input: {
    symbol: string;
    lite?: boolean;
    priority?: MarketDataPriority;
    maxAgeMs?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<MarketContextBundle> {
    const normalized = input.symbol.toUpperCase();
    const priority = input.priority ?? "normal";
    const lite = Boolean(input.lite);
    telemetry.totalRequests += 1;
    recordKind("contextBundle");

    return coalesce(`contextBundle:${normalized}:${lite ? "lite" : "full"}:${priority}`, async () => {
      const ticker = await this.getTicker(normalized, {
        priority,
        maxAgeMs: input.maxAgeMs,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
      });
      const resolvedSymbol = ticker.symbol.toUpperCase();
      const volume = ticker.volume24h;
      const needs24hKlines = !Number.isFinite(ticker.change24h) || Math.abs(Number(ticker.change24h)) < 0.2;
      const klinesMaxAge = input.maxAgeMs ?? resolveAdaptiveTtlMs({ kind: "klines", volume24h: volume, priority, interval: "1m" });
      const hourMaxAge = resolveAdaptiveTtlMs({ kind: "klines", volume24h: volume, priority, interval: "1h" });

      const [klines1m, orderBook, recentTrades, klines1h] = await Promise.all([
        this.getKlines(resolvedSymbol, "1m", 80, {
          priority,
          maxAgeMs: klinesMaxAge,
          signal: input.signal,
          timeoutMs: input.timeoutMs,
        }),
        lite
          ? Promise.resolve(null)
          : this.getOrderBook(resolvedSymbol, 30, {
              priority,
              maxAgeMs: resolveAdaptiveTtlMs({ kind: "orderBook", volume24h: volume, priority }),
              signal: input.signal,
              timeoutMs: input.timeoutMs,
            }),
        lite
          ? Promise.resolve(null)
          : this.getRecentTrades(resolvedSymbol, 150, {
              priority,
              maxAgeMs: resolveAdaptiveTtlMs({ kind: "recentTrades", volume24h: volume, priority }),
              signal: input.signal,
              timeoutMs: input.timeoutMs,
            }),
        needs24hKlines
          ? this.getKlines(resolvedSymbol, "1h", 26, {
              priority,
              maxAgeMs: hourMaxAge,
              signal: input.signal,
              timeoutMs: input.timeoutMs,
            })
          : Promise.resolve([] as KlineItem[]),
      ]);

      if (!lite && orderBook && recentTrades) {
        putMarketSnapshot(resolvedSymbol, { klines: klines1m, orderBook, recentTrades });
      }

      return {
        symbol: resolvedSymbol,
        ticker,
        klines1m,
        orderBook,
        recentTrades,
        klines1h,
      };
    });
  }

  getTelemetry(): MarketDataTelemetry {
    updateHitRatio();
    return { ...telemetry, requestsByKind: { ...telemetry.requestsByKind } };
  }

  resetTelemetry() {
    telemetry = createEmptyTelemetry();
    weightWindow.length = 0;
    latencySamples.length = 0;
    tickerCache.clear();
    klinesCache.clear();
    orderBookCache.clear();
    recentTradesCache.clear();
    exchangeInfoCache = null;
    inFlight.clear();
    backoffUntil = 0;
    backoffMs = 0;
    last429At = 0;
  }

  seedWeightUsageForTests(count: number) {
    const now = Date.now();
    for (let i = 0; i < count; i += 1) weightWindow.push(now);
    telemetry.estimatedWeight = currentWeightUsage(now);
  }
}

export const marketDataOrchestrator = new MarketDataOrchestrator();

export function mapOrchestratorTickerToMarketTicker(row: MarketDataTicker): MarketTicker {
  return {
    symbol: row.symbol,
    price: row.price,
    change24h: row.change24h,
    volume24h: row.volume24h,
    updatedAt: row.updatedAt,
  };
}
