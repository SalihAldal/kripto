import { env } from "@/lib/config";
import { marketDataGateway } from "@/src/server/market-data/market-data-gateway";

export type TopGainerDiscoveryItem = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  priorityScore: number;
  reason: string;
  discoveredAt: string;
  source: "TOP_GAINER_24H";
};

const CACHE_TTL_MS = 45_000;
let cache: { at: number; items: TopGainerDiscoveryItem[] } | null = null;
const MARKET_DATA_RETRY_LIMIT = 3;
const MARKET_DATA_BASE_DELAY_MS = 180;
const MARKET_DATA_REQUEST_TIMEOUT_MS = 4_000;
const MAX_CACHE_FALLBACK_AGE_MS = 3 * 60_000;

export type MarketDataReasonCode =
  | "MARKET_DATA_TIMEOUT"
  | "MARKET_DATA_NETWORK_ERROR"
  | "MARKET_DATA_RATE_LIMIT"
  | "MARKET_DATA_UNAVAILABLE"
  | "MARKET_DATA_STALE"
  | "MARKET_DATA_ABORTED";

export type TopGainerMarketDataEvent = {
  reasonCode: MarketDataReasonCode;
  symbol?: string;
  provider: string;
  endpoint: "/api/v3/ticker/24hr";
  startedAt: string;
  endedAt: string;
  durationMs: number;
  retryCount: number;
  fallbackUsed: boolean;
  fallbackSource?: "cache";
  fallbackUsedCount?: number;
  dataStatus: "LIVE" | "CACHE_FALLBACK" | "UNAVAILABLE";
};

export type DiscoverTopGainerOptions = {
  signal?: AbortSignal;
  onMarketDataEvent?: (event: TopGainerMarketDataEvent) => void;
};

export function getTopGainerCacheMeta() {
  if (!cache) {
    return {
      hasCache: false,
      cacheAgeMs: null,
      cacheTtlMs: CACHE_TTL_MS,
      stale: true,
    };
  }
  const age = Date.now() - cache.at;
  return {
    hasCache: true,
    cacheAgeMs: age,
    cacheTtlMs: CACHE_TTL_MS,
    stale: age >= CACHE_TTL_MS,
  };
}

function isBadLeveragedSymbol(symbol: string) {
  return symbol.includes("UP") || symbol.includes("DOWN") || symbol.includes("BULL") || symbol.includes("BEAR");
}

function normalizeScore(input: { change24h: number; volume24h: number }) {
  const changeScore = Math.max(0, Math.min(120, input.change24h));
  const volumeScore = Math.max(0, Math.min(40, Math.log10(Math.max(input.volume24h, 1)) * 4));
  return Number((changeScore * 0.78 + volumeScore * 0.22).toFixed(2));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveReasonCode(error: unknown): MarketDataReasonCode {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  if (message.includes("abort")) return "MARKET_DATA_ABORTED";
  if (message.includes("timed out") || message.includes("timeout")) return "MARKET_DATA_TIMEOUT";
  if (message.includes("http 429") || message.includes("rate limit")) return "MARKET_DATA_RATE_LIMIT";
  if (
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("network")
  ) {
    return "MARKET_DATA_NETWORK_ERROR";
  }
  return "MARKET_DATA_UNAVAILABLE";
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    throw new Error("MARKET_DATA_ABORTED");
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`MARKET_DATA_TIMEOUT after ${timeoutMs}ms`)), timeoutMs);
  });
  if (!signal) {
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }
  const abortPromise = new Promise<T>((_, reject) => {
    const abortHandler = () => {
      signal.removeEventListener("abort", abortHandler);
      reject(new Error("MARKET_DATA_ABORTED"));
    };
    signal.addEventListener("abort", abortHandler);
  });
  try {
    return await Promise.race([promise, timeoutPromise, abortPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function emitEvent(
  options: DiscoverTopGainerOptions | undefined,
  event: Omit<TopGainerMarketDataEvent, "startedAt" | "endedAt" | "durationMs"> & { startedMs: number; endedMs: number },
) {
  options?.onMarketDataEvent?.({
    ...event,
    startedAt: new Date(event.startedMs).toISOString(),
    endedAt: new Date(event.endedMs).toISOString(),
    durationMs: Math.max(0, event.endedMs - event.startedMs),
  });
}

export async function discoverTopGainerSymbols(
  limit = 24,
  options?: DiscoverTopGainerOptions,
): Promise<TopGainerDiscoveryItem[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.items.slice(0, limit);
  let rows: Awaited<ReturnType<typeof marketDataGateway.listTickers24h>> = [];
  let lastError: unknown = null;
  const requestStartedAt = Date.now();
  for (let attempt = 0; attempt < MARKET_DATA_RETRY_LIMIT; attempt += 1) {
    const startedMs = Date.now();
    try {
      rows = await withDeadline(
        marketDataGateway.listTickers24h(),
        MARKET_DATA_REQUEST_TIMEOUT_MS,
        options?.signal,
      );
      emitEvent(options, {
        reasonCode: "MARKET_DATA_UNAVAILABLE",
        provider: "BINANCE_TR",
        endpoint: "/api/v3/ticker/24hr",
        retryCount: attempt,
        fallbackUsed: false,
        dataStatus: "LIVE",
        startedMs: requestStartedAt,
        endedMs: Date.now(),
      });
      break;
    } catch (error) {
      lastError = error;
      const reasonCode = resolveReasonCode(error);
      emitEvent(options, {
        reasonCode,
        provider: "BINANCE_TR",
        endpoint: "/api/v3/ticker/24hr",
        retryCount: attempt + 1,
        fallbackUsed: false,
        dataStatus: "UNAVAILABLE",
        startedMs,
        endedMs: Date.now(),
      });
      if (reasonCode === "MARKET_DATA_ABORTED") throw error;
      if (attempt + 1 >= MARKET_DATA_RETRY_LIMIT) break;
      const jitterMs = Math.floor(Math.random() * 90);
      const delayMs = Math.min(1_200, MARKET_DATA_BASE_DELAY_MS * 2 ** attempt + jitterMs);
      await sleep(delayMs);
    }
  }
  if (rows.length === 0) {
    const cacheAgeMs = cache ? now - cache.at : Number.POSITIVE_INFINITY;
    if (cache && cacheAgeMs <= MAX_CACHE_FALLBACK_AGE_MS && cache.items.length > 0) {
      emitEvent(options, {
        reasonCode: cacheAgeMs > CACHE_TTL_MS ? "MARKET_DATA_STALE" : "MARKET_DATA_UNAVAILABLE",
        provider: "BINANCE_TR",
        endpoint: "/api/v3/ticker/24hr",
        retryCount: MARKET_DATA_RETRY_LIMIT,
        fallbackUsed: true,
        fallbackSource: "cache",
        fallbackUsedCount: Math.min(limit, cache.items.length),
        dataStatus: "CACHE_FALLBACK",
        startedMs: requestStartedAt,
        endedMs: Date.now(),
      });
      return cache.items.slice(0, limit);
    }
    if (lastError) {
      emitEvent(options, {
        reasonCode: resolveReasonCode(lastError),
        provider: "BINANCE_TR",
        endpoint: "/api/v3/ticker/24hr",
        retryCount: MARKET_DATA_RETRY_LIMIT,
        fallbackUsed: false,
        dataStatus: "UNAVAILABLE",
        startedMs: requestStartedAt,
        endedMs: Date.now(),
      });
    }
    return [];
  }
  const minChange = env.PUMP_DISCOVERY_MIN_CHANGE_24H;
  const minVolume = Math.max(80_000, env.SCANNER_MIN_VOLUME_24H * 0.25);
  const quoteSuffix = env.BINANCE_PLATFORM === "tr" ? "TRY" : "USDT";
  const items = rows
    .filter((row) => row.symbol.endsWith(quoteSuffix))
    .filter((row) => !isBadLeveragedSymbol(row.symbol))
    .filter((row) => row.change24h >= minChange && row.volume24h >= minVolume)
    .map((row) => ({
      ...row,
      priorityScore: normalizeScore(row),
      reason: `top-gainer change=${row.change24h.toFixed(2)}% volume=${row.volume24h.toFixed(0)}`,
      discoveredAt: new Date(now).toISOString(),
      source: "TOP_GAINER_24H" as const,
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, Math.max(limit, 36));
  cache = { at: now, items };
  return items.slice(0, limit);
}
