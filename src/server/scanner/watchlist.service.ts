import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { listTradableSymbols, listTradableUsdtSymbols } from "@/services/binance.service";
import { getWatchlistFromSettings } from "@/src/server/repositories/scanner.repository";
import { discoverTopGainerSymbols } from "@/src/server/scanner/top-gainer-discovery.service";

function buildSymbolVariants(symbol: string) {
  const normalized = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const variants = new Set<string>();
  if (env.BINANCE_PLATFORM === "tr") {
    if (normalized.endsWith("USDT")) variants.add(`${normalized.slice(0, -4)}TRY`);
    variants.add(normalized.endsWith("TRY") ? normalized : `${normalized}TRY`);
    return Array.from(variants).filter((x) => x.endsWith("TRY"));
  }
  variants.add(normalized);
  if (normalized.endsWith("USDT")) variants.add(`${normalized.slice(0, -4)}TRY`);
  if (normalized.endsWith("TRY")) variants.add(`${normalized.slice(0, -3)}USDT`);
  return Array.from(variants);
}

async function remapToTradableSymbols(symbols: string[]) {
  try {
    const tradable = await listTradableSymbols(env.SCANNER_MAX_SYMBOLS);
    if (tradable.length === 0) return symbols;
    const set = new Set(
      tradable
        .map((x) => x.toUpperCase())
        .filter((x) => (env.BINANCE_PLATFORM === "tr" ? x.endsWith("TRY") : true)),
    );
    const remapped: string[] = [];
    for (const symbol of symbols) {
      const picked = buildSymbolVariants(symbol).find((candidate) => set.has(candidate));
      if (picked) remapped.push(picked);
    }
    return remapped.length > 0 ? Array.from(new Set(remapped)) : symbols;
  } catch {
    return symbols;
  }
}

const UNIVERSE_CACHE_TTL_MS = 120_000;
const UNIVERSE_BACKOFF_MS = 20_000;
const FORCED_WATCHLIST_TTL_MS = 5 * 60_000;
let allSpotCache: { symbols: string[]; at: number } | null = null;
let allUsdtCache: { symbols: string[]; at: number } | null = null;
let universeBackoffUntil = 0;
let forcedWatchlistUntil = 0;

function isFresh(cache: { symbols: string[]; at: number } | null) {
  return Boolean(cache && Date.now() - cache.at < UNIVERSE_CACHE_TTL_MS && cache.symbols.length > 0);
}

function isRateLimitedLikeError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return (
    message.includes("http 429") ||
    message.includes("too many requests") ||
    message.includes("rate limit") ||
    message.includes("operation was aborted") ||
    message.includes("aborted") ||
    message.includes("econnreset") ||
    message.includes("fetch failed")
  );
}

export async function resolveWatchlist(userId?: string): Promise<string[]> {
  const topGainers = await discoverTopGainerSymbols(36).catch(() => []);
  const topGainerSymbols = topGainers.map((row) => row.symbol);
  const allUniverseEnabled = env.SCANNER_UNIVERSE === "ALL_USDT";
  const allSpotEnabled = env.SCANNER_UNIVERSE === "ALL_SPOT";
  const forcedWatchlistMode = Date.now() < forcedWatchlistUntil;

  if (allUniverseEnabled) {
    if (isFresh(allUsdtCache)) return allUsdtCache!.symbols;
    if (!forcedWatchlistMode) {
      if (Date.now() < universeBackoffUntil && allUsdtCache?.symbols?.length) return allUsdtCache.symbols;
      try {
        const allUsdt = await listTradableUsdtSymbols(env.SCANNER_MAX_SYMBOLS);
        if (allUsdt.length > 0) {
          const normalized =
            env.BINANCE_PLATFORM === "tr"
              ? allUsdt
                  .map((symbol) => symbol.toUpperCase().replace(/USDT$/, "TRY"))
                  .filter((symbol) => symbol.endsWith("TRY"))
              : allUsdt.map((symbol) => symbol.toUpperCase());
          const deduped = Array.from(new Set(normalized));
          allUsdtCache = { symbols: deduped, at: Date.now() };
          return Array.from(new Set([...topGainerSymbols, ...deduped]));
        }
      } catch (error) {
        universeBackoffUntil = Date.now() + UNIVERSE_BACKOFF_MS;
        if (isRateLimitedLikeError(error)) {
          forcedWatchlistUntil = Date.now() + FORCED_WATCHLIST_TTL_MS;
        }
        logger.warn({ error: (error as Error).message }, "ALL_USDT universe fetch failed");
        if (allUsdtCache?.symbols?.length) return Array.from(new Set([...topGainerSymbols, ...allUsdtCache.symbols]));
      }
    } else if (allUsdtCache?.symbols?.length) {
      return Array.from(new Set([...topGainerSymbols, ...allUsdtCache.symbols]));
    }
  }

  if (allSpotEnabled) {
    if (isFresh(allSpotCache)) return allSpotCache!.symbols;
    if (!forcedWatchlistMode) {
      if (Date.now() < universeBackoffUntil && allSpotCache?.symbols?.length) return allSpotCache.symbols;
      try {
        const allSpot = await listTradableSymbols(env.SCANNER_MAX_SYMBOLS);
        if (allSpot.length > 0) {
          const normalized =
            env.BINANCE_PLATFORM === "tr"
              ? allSpot.map((symbol) => symbol.toUpperCase()).filter((symbol) => symbol.endsWith("TRY"))
              : allSpot.map((symbol) => symbol.toUpperCase());
          if (normalized.length > 0) {
            const deduped = Array.from(new Set(normalized));
            allSpotCache = { symbols: deduped, at: Date.now() };
            return Array.from(new Set([...topGainerSymbols, ...deduped]));
          }
        }
      } catch (error) {
        universeBackoffUntil = Date.now() + UNIVERSE_BACKOFF_MS;
        if (isRateLimitedLikeError(error)) {
          forcedWatchlistUntil = Date.now() + FORCED_WATCHLIST_TTL_MS;
        }
        logger.warn({ error: (error as Error).message }, "ALL_SPOT universe fetch failed");
        if (allSpotCache?.symbols?.length) return Array.from(new Set([...topGainerSymbols, ...allSpotCache.symbols]));
      }
    } else if (allSpotCache?.symbols?.length) {
      return Array.from(new Set([...topGainerSymbols, ...allSpotCache.symbols]));
    }
  }

  try {
    const fromDb = await getWatchlistFromSettings(userId);
    if (fromDb && fromDb.length > 0) {
      const mapped = await remapToTradableSymbols(Array.from(new Set(fromDb.map((x) => x.toUpperCase()))));
      return Array.from(new Set([...topGainerSymbols, ...mapped]));
    }
  } catch (error) {
    logger.warn({ error: (error as Error).message }, "Watchlist DB okunamadi, fallback kullaniliyor");
  }

  const fromEnv = env.SCANNER_WATCHLIST.split(",")
    .map((x) => x.trim().toUpperCase())
    .filter((x) => Boolean(x) && x !== "ALL_USDT" && x !== "ALL_SPOT" && x !== "*");

  const mappedEnv = await remapToTradableSymbols(Array.from(new Set(fromEnv)));
  return Array.from(new Set([...topGainerSymbols, ...mappedEnv]));
}
