import { getTicker } from "@/services/binance.service";
import { MAX_PRICE_DRIFT_PCT, PRICE_CACHE_TTL_MS } from "@/src/server/execution-safety/execution-safety.types";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";

const priceCache = new Map<string, { price: number; at: number }>();

function round(value: number) {
  return Number(value.toFixed(8));
}

export function computePriceDriftPct(referencePrice: number, latestPrice: number) {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0 || !Number.isFinite(latestPrice) || latestPrice <= 0) {
    return 100;
  }
  return Math.abs(((latestPrice - referencePrice) / referencePrice) * 100);
}

export async function validatePriceSafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  const cacheKey = input.symbol.toUpperCase();
  const cached = priceCache.get(cacheKey);
  const now = Date.now();

  let fetchedFresh = false;
  let livePrice = cached && now - cached.at < PRICE_CACHE_TTL_MS ? cached.price : 0;
  if (!livePrice) {
    const ticker = await getTicker(input.symbol).catch(() => null);
    livePrice = Number(ticker?.price ?? 0);
    if (livePrice > 0) {
      priceCache.set(cacheKey, { price: livePrice, at: now });
      fetchedFresh = true;
    }
  }

  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    reasons.push("Current Binance price unavailable");
    return { stage: "PRICE", passed: false, reasons, metadata: { stale: true } };
  }

  const isStale = !fetchedFresh && (!cached || now - cached.at > PRICE_CACHE_TTL_MS);
  if (isStale) {
    reasons.push("Exchange data is stale");
  }

  const marketSnapshotPrice =
    getMarketDataDaemon()
      .getMarketSnapshot()
      .find((row) => row.symbol.toUpperCase() === cacheKey)?.lastPrice ?? 0;
  const localPrice = marketSnapshotPrice > 0 ? marketSnapshotPrice : input.priceHint;
  const driftPct = computePriceDriftPct(localPrice, livePrice);
  if (driftPct > MAX_PRICE_DRIFT_PCT) {
    reasons.push(`Price drift exceeds tolerance (${driftPct.toFixed(3)}%)`);
  }

  const spreadPct = input.spreadPercent ?? 0;
  if (spreadPct > 1.2) {
    reasons.push(`Spread too wide (${spreadPct.toFixed(3)}%)`);
  }

  const atr = input.atr ?? 0;
  if (atr > 0 && localPrice > 0) {
    const atrMovePct = (atr / localPrice) * 100;
    if (atrMovePct > 3.5) {
      reasons.push("ATR movement indicates fast price movement");
    }
  }

  const volatility = input.volatilityPercent ?? 0;
  if (volatility > 8) {
    reasons.push("Flash volatility detected");
  }

  const flashMove = localPrice > 0 && Math.abs(livePrice - localPrice) / localPrice > 0.025;
  if (flashMove && driftPct > MAX_PRICE_DRIFT_PCT * 0.8) {
    reasons.push("Flash candle price jump detected");
  }

  return {
    stage: "PRICE",
    passed: reasons.length === 0,
    reasons,
    metadata: {
      livePrice: round(livePrice),
      localPrice: round(localPrice),
      inputPriceHint: round(input.priceHint),
      driftPct: round(driftPct),
      spreadPct,
      stale: isStale,
      localPriceSource: marketSnapshotPrice > 0 ? "market_snapshot" : "price_hint",
    },
  };
}

export function clearPriceCache(symbol?: string) {
  if (symbol) priceCache.delete(symbol.toUpperCase());
  else priceCache.clear();
}
