import { env } from "@/lib/config";
import { marketDataGateway } from "@/src/server/market-data/market-data-gateway";
import { getMarketDataDaemon } from "@/src/server/market-data/spine/market-data-daemon";
import { resolveAdaptiveTtlMs } from "@/src/server/market-data";
import type { MarketDataPriority } from "@/src/server/market-data/market-data.types";
import { isMarketDataUnavailableError } from "@/src/server/market-data/market-data-unavailable.error";
import { putMarketSnapshot } from "@/src/server/scanner/market-snapshot-cache";
import { detectMarketRegime } from "@/src/server/scanner/market-regime.service";
import { recordRegimeStability } from "@/src/server/scanner/regime-stability.service";
import { getSocialSentimentSnapshotSafe } from "@/src/server/social/social-sentiment.service";
import { collectPreTradeFuturesIntelligence } from "@/src/server/futures/futures-intelligence.service";
import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

const CONTEXT_CACHE_TTL_MS = 180_000;
const contextCache = new Map<string, { at: number; context: MarketContext }>();

export type PumpRiskComputation = {
  score: number;
  rawScore: number;
  capped: boolean;
  status: "AVAILABLE" | "UNAVAILABLE";
  reason: string;
};

export function computePumpRisk(input: {
  spreadPercent: number;
  fakeSpikeScore: number;
  priceDispersionPercent: number;
  orderBookImbalance: number;
}): PumpRiskComputation {
  const parts = [
    Number(input.spreadPercent),
    Number(input.fakeSpikeScore),
    Number(input.priceDispersionPercent),
    Number(input.orderBookImbalance),
  ];
  const hasInvalid = parts.some((v) => !Number.isFinite(v));
  if (hasInvalid) {
    return {
      score: 0,
      rawScore: 0,
      capped: false,
      status: "UNAVAILABLE",
      reason: "PUMP_RISK_INPUT_UNAVAILABLE",
    };
  }
  const rawScore =
    input.spreadPercent * 120 +
    input.fakeSpikeScore * 18 +
    input.priceDispersionPercent * 18 +
    Math.abs(input.orderBookImbalance) * 40;
  const bounded = Math.max(0, Math.min(100, rawScore));
  return {
    score: Number(bounded.toFixed(2)),
    rawScore: Number(rawScore.toFixed(4)),
    capped: rawScore >= 100,
    status: "AVAILABLE",
    reason: rawScore >= 100 ? "FORMULA_CLAMP_100" : "FORMULA_V1",
  };
}

function stdDev(values: number[]) {
  const mean = values.reduce((acc, v) => acc + v, 0) / Math.max(values.length, 1);
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(values.length, 1);
  return Math.sqrt(variance);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function ema(values: number[], period: number) {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function trueRange(current: KlineItem, prev: KlineItem | null) {
  if (!prev) return current.high - current.low;
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - prev.close),
    Math.abs(current.low - prev.close),
  );
}

function computeAtrPercent(klines: KlineItem[], period = 14) {
  if (klines.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 0; i < klines.length; i += 1) {
    trs.push(trueRange(klines[i], i > 0 ? klines[i - 1] : null));
  }
  const atrValue = trs.slice(-period).reduce((acc, x) => acc + x, 0) / Math.max(Math.min(period, trs.length), 1);
  const price = klines[klines.length - 1]?.close ?? 0;
  return price > 0 ? Number(((atrValue / price) * 100).toFixed(4)) : 0;
}

function isFinitePositive(value: number | undefined | null) {
  return Number.isFinite(value) && Number(value) > 0;
}

function hasLiveKlineSignal(closes: number[], volumes: number[]) {
  if (closes.length < 6) return false;
  const positiveVolumes = volumes.filter((x) => x > 0).length;
  return positiveVolumes >= Math.max(2, Math.floor(volumes.length * 0.05));
}

function hasLiveOrderBookSignal(
  bids: Array<{ price: number; quantity: number }>,
  asks: Array<{ price: number; quantity: number }>,
) {
  const bidDepth = bids.reduce((acc, row) => acc + row.quantity * row.price, 0);
  const askDepth = asks.reduce((acc, row) => acc + row.quantity * row.price, 0);
  return bidDepth > 0 && askDepth > 0;
}

function hasLiveTradesSignal(trades: Array<{ qty: number; price: number }>) {
  const notional = trades.reduce((acc, row) => acc + row.qty * row.price, 0);
  return notional > 0;
}

function fallbackKlines(price: number, limit: number) {
  const now = Date.now();
  return Array.from({ length: limit }).map((_, idx) => {
    const drift = ((idx % 6) - 3) * 0.0009;
    const open = price * (1 + drift);
    const close = price * (1 + drift * 0.95);
    return {
      openTime: now - (limit - idx) * 60_000,
      closeTime: now - (limit - idx - 1) * 60_000,
      open,
      high: Math.max(open, close) * 1.0008,
      low: Math.min(open, close) * 0.9992,
      close,
      volume: 0,
    };
  });
}

function deriveKlinesFromWindow(
  points: Array<{ t: number; price: number; quoteVolume?: number }>,
  limit: number,
): KlineItem[] {
  if (points.length === 0) return [];
  const bucketMs = 60_000;
  const byBucket = new Map<number, Array<{ t: number; price: number; quoteVolume?: number }>>();
  for (const point of points) {
    const key = Math.floor(point.t / bucketMs) * bucketMs;
    const arr = byBucket.get(key) ?? [];
    arr.push(point);
    byBucket.set(key, arr);
  }
  const rows = [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-limit)
    .map(([openTime, bucket]) => {
      const sorted = bucket.sort((a, b) => a.t - b.t);
      const open = sorted[0]?.price ?? 0;
      const close = sorted[sorted.length - 1]?.price ?? open;
      const high = Math.max(...sorted.map((row) => row.price));
      const low = Math.min(...sorted.map((row) => row.price));
      const volume = sorted.reduce((acc, row) => acc + Number(row.quoteVolume ?? 0), 0);
      return {
        openTime,
        closeTime: openTime + bucketMs - 1,
        open,
        high,
        low,
        close,
        volume,
      } satisfies KlineItem;
    });
  return rows;
}

function fallbackRecentTrades(price: number, limit: number) {
  const now = Date.now();
  return Array.from({ length: limit }).map((_, idx) => ({
    id: now - idx,
    price: Number(price.toFixed(8)),
    qty: 0,
    time: now - idx * 1200,
    isBuyerMaker: idx % 2 === 0,
  }));
}

function getCachedHealthyContext(symbol: string, maxAgeMs = CONTEXT_CACHE_TTL_MS) {
  const cached = contextCache.get(symbol);
  if (!cached) return null;
  if (Date.now() - cached.at > maxAgeMs) return null;
  return cached.context;
}

function rememberContext(context: MarketContext) {
  const healthy =
    context.volume24h >= env.SCANNER_MIN_VOLUME_24H &&
    context.spreadPercent <= env.SCANNER_MAX_SPREAD_PERCENT * 1.35;
  if (!healthy) return;
  contextCache.set(context.symbol, { at: Date.now(), context });
}

export async function buildMarketContext(
  symbol: string,
  options?: {
    lite?: boolean;
    forceLive?: boolean;
    priority?: MarketDataPriority;
    signal?: AbortSignal;
    timeoutMs?: number;
    allowBackgroundIntelCapture?: boolean;
  },
): Promise<MarketContext> {
  const normalized = symbol.toUpperCase();
  const lite = Boolean(options?.lite);
  const priority = options?.priority ?? (options?.forceLive ? "high" : "normal");
  const maxAgeMs = resolveAdaptiveTtlMs({
    kind: "contextBundle",
    priority,
    volume24h: undefined,
  });
  const recentCached = getCachedHealthyContext(normalized, Math.max(60_000, maxAgeMs));
  if (recentCached && recentCached.metadata?.dataQualityOk) {
    const cacheAgeMs = Date.now() - (contextCache.get(normalized)?.at ?? 0);
    const freshEnough = !options?.forceLive || cacheAgeMs <= maxAgeMs;
    if (freshEnough) {
      return {
        ...recentCached,
        metadata: {
          ...recentCached.metadata,
          fallbackFromCache: true,
          fallbackReason: "recent_cache",
        },
      };
    }
  }
  let bundle;
  try {
    bundle = await marketDataGateway.fetchContextBundle({
      symbol: normalized,
      lite,
      priority,
      maxAgeMs: options?.forceLive ? maxAgeMs : undefined,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
  } catch (error) {
    if (isMarketDataUnavailableError(error)) {
      return {
        symbol: normalized,
        lastPrice: 0,
        change24h: 0,
        volume24h: 0,
        volumeSpikePercent: 0,
        spreadPercent: 0,
        volatilityPercent: 0,
        momentumPercent: 0,
        orderBookImbalance: 0,
        buyPressure: 0.5,
        shortCandleSignal: 0,
        fakeSpikeScore: 0,
        pumpIntensity: 0,
        pumpRisk: 0,
        tradable: false,
        rejectReasons: [error.code],
        metadata: {
          dataQualityOk: false,
          marketDataCode: error.code,
          liveDataHealthy: false,
        },
      };
    }
    throw error;
  }
  const ticker = bundle.ticker;
  const resolvedSymbol = ticker.symbol.toUpperCase();
  const safeTickerPrice = Number.isFinite(ticker.price) && ticker.price > 0 ? ticker.price : 1;
  const safeTickerVolume = Number.isFinite(ticker.volume24h) && ticker.volume24h > 0 ? ticker.volume24h : 0;
  const ringWindowMs = 15 * 60_000;
  const ringWindow = getMarketDataDaemon().getWindow(normalized, ringWindowMs);
  const derivedKlines = deriveKlinesFromWindow(ringWindow, 80);
  const klineSource = bundle.klines1m.length > 0
    ? "WS_KLINE"
    : derivedKlines.length > 0
      ? "WS_DERIVED"
      : env.MARKET_DATA_ALLOW_SYNTHETIC
        ? "SYNTHETIC"
        : "MISSING";
  const klines = bundle.klines1m.length > 0
    ? bundle.klines1m
    : derivedKlines.length > 0
      ? derivedKlines
      : env.MARKET_DATA_ALLOW_SYNTHETIC
        ? fallbackKlines(safeTickerPrice, 80)
        : [];
  const klines24h = bundle.klines1h.length > 0 ? bundle.klines1h : [];
  const orderBook =
    !lite &&
    bundle.orderBook &&
    bundle.orderBook.bids.length > 0 &&
    bundle.orderBook.asks.length > 0
      ? bundle.orderBook
      : env.MARKET_DATA_ALLOW_SYNTHETIC
        ? {
            lastUpdateId: Date.now(),
            bids: [{ price: safeTickerPrice, quantity: 0 }],
            asks: [{ price: safeTickerPrice, quantity: 0 }],
          }
        : { lastUpdateId: 0, bids: [], asks: [] };
  const recentTrades =
    !lite && bundle.recentTrades && bundle.recentTrades.length > 0
      ? bundle.recentTrades
      : env.MARKET_DATA_ALLOW_SYNTHETIC
        ? fallbackRecentTrades(safeTickerPrice, 150)
        : [];

  if (!lite && bundle.orderBook && bundle.recentTrades) {
    putMarketSnapshot(resolvedSymbol, { klines, orderBook, recentTrades });
  }

  const closes = klines.map((x) => x.close);
  const volumes = klines.map((x) => Number(x.volume ?? 0));
  const liveKlines = hasLiveKlineSignal(closes, volumes);
  const liveOrderBook = !lite && hasLiveOrderBookSignal(orderBook.bids, orderBook.asks);
  const liveTrades = !lite && hasLiveTradesSignal(recentTrades);
  const tickerUpdatedAtMs = Date.parse(String(ticker.updatedAt ?? ""));
  const nowForTicker = Date.now();
  const tickerFresh = Number.isFinite(tickerUpdatedAtMs)
    ? nowForTicker - tickerUpdatedAtMs <= Math.max(5_000, env.MARKET_DATA_STALE_MS)
    : true;
  const coreMarketDataHealthy = tickerFresh && isFinitePositive(safeTickerPrice);
  const rollingHistoryHealthy = closes.length >= 6;
  const klineHealthy = closes.length >= 20;
  const microDataHealthy = !lite && (liveOrderBook || liveTrades);
  const liveDataHealthy = coreMarketDataHealthy && (rollingHistoryHealthy || microDataHealthy || liveKlines);

  const latestClose = closes[closes.length - 1];
  const latestTradePrice = recentTrades[recentTrades.length - 1]?.price;
  const bestBidCandidate = orderBook.bids[0]?.price;
  const bestAskCandidate = orderBook.asks[0]?.price;
  const bookMidCandidate =
    isFinitePositive(bestBidCandidate) && isFinitePositive(bestAskCandidate)
      ? Number((((bestBidCandidate + bestAskCandidate) / 2)).toFixed(8))
      : undefined;
  const live24hKlines = klines24h.length > 1 && klines24h.some((row) => Number(row.volume ?? 0) > 0);
  const change24hFrom1h =
    live24hKlines && klines24h[0] && Number(klines24h[0].open) > 0
      ? Number((((Number(klines24h[klines24h.length - 1].close) - Number(klines24h[0].open)) / Number(klines24h[0].open)) * 100).toFixed(4))
      : 0;
  const derivedChange24h =
    liveKlines && closes.length > 1 && closes[0] > 0
      ? Number((((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(4))
      : 0;
  const tickerChange24h = Number.isFinite(ticker.change24h) ? Number(ticker.change24h) : 0;
  const useDerived24h = !Number.isFinite(ticker.change24h) || tickerChange24h === 0;
  const change24hCandidate = change24hFrom1h !== 0 ? change24hFrom1h : derivedChange24h;
  const change24h =
    useDerived24h && change24hCandidate !== 0
      ? change24hCandidate
      : Number.isFinite(ticker.change24h)
        ? tickerChange24h
        : 0;
  const priceCandidates = [safeTickerPrice, latestClose, latestTradePrice, bookMidCandidate]
    .filter((x): x is number => isFinitePositive(x))
    .map((x) => Number(x.toFixed(8)));
  const trustedPrice = priceCandidates.length > 0 ? median(priceCandidates) : safeTickerPrice;
  const tickerDeviationPercent =
    trustedPrice > 0 ? Math.abs((safeTickerPrice - trustedPrice) / trustedPrice) * 100 : 0;
  const tickerOutlier = priceCandidates.length >= 2 && tickerDeviationPercent >= 35;
  let effectiveLastPrice = tickerOutlier ? trustedPrice : safeTickerPrice;
  const priceCandidateMax = priceCandidates.length > 0 ? Math.max(...priceCandidates) : effectiveLastPrice;
  const priceCandidateMin = priceCandidates.length > 0 ? Math.min(...priceCandidates) : effectiveLastPrice;
  const priceDispersionPercent =
    trustedPrice > 0 ? ((priceCandidateMax - priceCandidateMin) / trustedPrice) * 100 : 0;
  const priceAnomaly = liveKlines && priceDispersionPercent >= 20;
  if (priceAnomaly && isFinitePositive(latestClose) && trustedPrice > 0) {
    const closeDeviation = Math.abs((latestClose - trustedPrice) / trustedPrice) * 100;
    if (closeDeviation <= 35) {
      effectiveLastPrice = latestClose;
    }
  }

  const momentumPercent =
    closes.length > 5
      ? Number((((closes[closes.length - 1] - closes[Math.max(0, closes.length - 6)]) / Math.max(closes[Math.max(0, closes.length - 6)], 1)) * 100).toFixed(4))
      : 0;
  const trendAnchor = closes[Math.max(0, closes.length - 24)] ?? closes[0] ?? effectiveLastPrice;
  const trendStrength = trendAnchor > 0 ? Number((((effectiveLastPrice - trendAnchor) / trendAnchor)).toFixed(4)) : 0;
  const volatilityPercent =
    closes.length > 2
      ? Number(((stdDev(closes) / Math.max(closes.reduce((a, b) => a + b, 0) / closes.length, 1)) * 100).toFixed(4))
      : 0;

  const bestBid = orderBook.bids[0]?.price ?? effectiveLastPrice;
  const bestAsk = orderBook.asks[0]?.price ?? effectiveLastPrice;
  const spreadPercent = Number((((bestAsk - bestBid) / Math.max(bestAsk, 1)) * 100).toFixed(4));
  const bookMid =
    isFinitePositive(bestBid) && isFinitePositive(bestAsk)
      ? Number(((bestBid + bestAsk) / 2).toFixed(8))
      : effectiveLastPrice;
  const bookDeviationPercent =
    effectiveLastPrice > 0 ? Math.abs(((bookMid - effectiveLastPrice) / effectiveLastPrice) * 100) : 0;

  const bidDepth = orderBook.bids.reduce((acc, row) => acc + row.quantity * row.price, 0);
  const askDepth = orderBook.asks.reduce((acc, row) => acc + row.quantity * row.price, 0);
  const orderBookImbalance = Number(((bidDepth - askDepth) / Math.max(bidDepth + askDepth, 0.0001)).toFixed(4));

  const buyPressureVol = recentTrades
    .filter((x) => !x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const sellPressureVol = recentTrades
    .filter((x) => x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const buyPressure = Number((buyPressureVol / Math.max(buyPressureVol + sellPressureVol, 0.0001)).toFixed(4));

  const now = Date.now();
  const windowSec = Math.max(10, env.SCANNER_SHORT_HORIZON_SEC);
  const windowMs = windowSec * 1000;
  const shortWindowTrades = recentTrades
    .filter((x) => now - x.time <= windowMs)
    .sort((a, b) => a.time - b.time);
  const shortTradeCount = shortWindowTrades.length;
  const shortFirst = shortWindowTrades[0]?.price ?? effectiveLastPrice;
  const shortLast = shortWindowTrades[shortTradeCount - 1]?.price ?? effectiveLastPrice;
  const shortMomentumPercent = Number((((shortLast - shortFirst) / Math.max(shortFirst, 1)) * 100).toFixed(4));
  const hourMomentumPercent =
    closes.length >= 60 && closes[closes.length - 60] > 0
      ? Number(
          (
            ((closes[closes.length - 1] - closes[closes.length - 60]) / closes[closes.length - 60]) *
            100
          ).toFixed(4),
        )
      : shortMomentumPercent;
  const tradeVelocity = Number((shortTradeCount / Math.max(windowSec, 1)).toFixed(4));
  const shortBuyVolume = shortWindowTrades
    .filter((x) => !x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const shortSellVolume = shortWindowTrades
    .filter((x) => x.isBuyerMaker)
    .reduce((acc, x) => acc + x.qty * x.price, 0);
  const shortFlowImbalance = Number(
    ((shortBuyVolume - shortSellVolume) / Math.max(shortBuyVolume + shortSellVolume, 0.0001)).toFixed(4),
  );

  const spikeWindow = 6;
  const spikeRecent = klines.slice(-spikeWindow);
  const spikePrev = klines.slice(-(spikeWindow * 2), -spikeWindow);
  const spikeRecentNotional = spikeRecent.reduce((acc, row) => acc + Number(row.volume ?? 0) * Number(row.close ?? 0), 0);
  const spikePrevNotional = spikePrev.reduce((acc, row) => acc + Number(row.volume ?? 0) * Number(row.close ?? 0), 0);
  const volumeSpikePercent =
    spikePrevNotional > 0
      ? Number((((spikeRecentNotional - spikePrevNotional) / spikePrevNotional) * 100).toFixed(2))
      : spikeRecentNotional > 0
        ? 200
        : 0;
  const pumpIntensity = Number(
    Math.max(
      0,
      Math.min(
        100,
        shortMomentumPercent * 6 +
          tradeVelocity * 18 +
          volumeSpikePercent * 0.25 +
          Math.max(0, (buyPressure - 0.5) * 200) * 0.6,
      ),
    ).toFixed(2),
  );

  const lastTradeAt = recentTrades[recentTrades.length - 1]?.time ?? 0;
  const lastKlineAt = klines[klines.length - 1]?.closeTime ?? 0;
  const nowSnapshot = now;
  const staleThresholdSec = Math.max(90, env.SCANNER_SHORT_HORIZON_SEC * 1.5);
  const lastTradeAgeSec = lastTradeAt ? Math.max(0, Math.floor((nowSnapshot - lastTradeAt) / 1000)) : null;
  const lastKlineAgeSec = lastKlineAt ? Math.max(0, Math.floor((nowSnapshot - lastKlineAt) / 1000)) : null;
  const stalePrice =
    (lastTradeAgeSec !== null && lastTradeAgeSec > staleThresholdSec) ||
    (lastKlineAgeSec !== null && lastKlineAgeSec > staleThresholdSec);
  const missingKlines = klines.length < 6;
  const weakKlineCoverage = klines.length < 20;
  const dataQualityIssues = [
    stalePrice ? "PRICE_STALE" : "",
    missingKlines ? "KLINE_MISSING" : "",
    weakKlineCoverage ? "KLINE_WEAK_COVERAGE" : "",
    bookDeviationPercent >= 0.8 ? "BOOK_PRICE_DEVIATION" : "",
    tickerOutlier || priceDispersionPercent >= 2 ? "CONFLICTING_PRICES" : "",
    priceAnomaly ? "PRICE_ANOMALY_FALLBACK" : "",
    useDerived24h ? "CHANGE24H_FALLBACK" : "",
  ].filter(Boolean);

  const snapshotTradeNotional = buyPressureVol + sellPressureVol;
  const snapshotBookNotional = bidDepth + askDepth;
  const snapshotNotional = Math.max(snapshotTradeNotional, snapshotBookNotional);
  const snapshotMinLiquidity = Math.max(10_000, env.SCANNER_MIN_VOLUME_24H * 0.02);
  const hasReliableSnapshotLiquidity = snapshotNotional >= snapshotMinLiquidity;
  const klineNotionalSum = liveKlines
    ? klines.reduce((acc, row) => acc + Number(row.volume ?? 0) * Number(row.close ?? 0), 0)
    : 0;
  const approxVolume24h = klineNotionalSum > 0
    ? Number(((klineNotionalSum * (1440 / Math.max(klines.length, 1)))).toFixed(2))
    : 0;
  // Short-window flow and resting depth are not observed 24h turnover.
  // Retain their diagnostics below, but never substitute them into a 24h gate.
  const effectiveLiquidity24h = safeTickerVolume;

  const shortCandleSignal = klines.slice(-4).reduce((acc, row) => {
    const body = row.close - row.open;
    return acc + (body > 0 ? 1 : -1);
  }, 0);

  const ema50 = closes.length >= 50 ? Number(ema(closes, 50).toFixed(8)) : 0;
  const ema200 = closes.length >= 50 ? Number(ema(closes, Math.min(200, closes.length)).toFixed(8)) : 0;
  const rsi14 = Number(rsi(closes, 14).toFixed(2));
  const dump15mPercent =
    closes.length >= 16 && closes[closes.length - 16] > 0
      ? Number(
          (
            ((closes[closes.length - 1] - closes[closes.length - 16]) / closes[closes.length - 16]) *
            100
          ).toFixed(4),
        )
      : 0;
  const redCandleCount5 = klines.slice(-5).filter((row) => row.close < row.open).length;
  const currentVol = volumes[volumes.length - 1] ?? 0;
  const avgVol20 =
    volumes.length >= 23
      ? volumes.slice(-23, -3).reduce((acc, value) => acc + value, 0) / 20
      : volumes.length > 3
        ? volumes.slice(0, -3).reduce((acc, value) => acc + value, 0) / Math.max(volumes.length - 3, 1)
        : 0;
  const recentVol3 =
    volumes.length >= 3 ? volumes.slice(-3).reduce((acc, value) => acc + value, 0) / 3 : currentVol;
  const volumeRatio20 = avgVol20 > 0 ? Number((recentVol3 / avgVol20).toFixed(4)) : 0;
  const atrPercent = computeAtrPercent(klines, 14);
  const last60Klines = klines.slice(-60);
  const high60m =
    last60Klines.length > 0 ? Math.max(...last60Klines.map((row) => row.high)) : effectiveLastPrice;
  const low60m =
    last60Klines.length > 0 ? Math.min(...last60Klines.map((row) => row.low)) : effectiveLastPrice;
  const distanceFrom60mHighPercent =
    high60m > 0
      ? Number((((high60m - effectiveLastPrice) / high60m) * 100).toFixed(4))
      : 0;
  const extensionFrom60mLowPercent =
    low60m > 0
      ? Number((((effectiveLastPrice - low60m) / low60m) * 100).toFixed(4))
      : 0;

  const fakeSpikeScore = Number(
    (
      Math.max(0, Math.abs(momentumPercent) - 1.2) *
      (spreadPercent > env.SCANNER_MAX_SPREAD_PERCENT ? 1.8 : 1) *
      (effectiveLiquidity24h < env.SCANNER_MIN_VOLUME_24H ? 1.6 : 1)
    ).toFixed(4),
  );

  const pumpRiskComputation = computePumpRisk({
    spreadPercent,
    fakeSpikeScore,
    priceDispersionPercent,
    orderBookImbalance,
  });
  const pumpRisk = pumpRiskComputation.score;

  const [socialSnapshot, futuresIntel] = await Promise.all([
    lite ? Promise.resolve(null) : getSocialSentimentSnapshotSafe(resolvedSymbol),
    lite
      ? Promise.resolve(null)
      : collectPreTradeFuturesIntelligence({
          symbol: resolvedSymbol,
          lastPrice: effectiveLastPrice,
          priceChangePercent: change24h,
          shortMomentumPercent,
        }).catch(() => null),
  ]);
  const macroNewsSentiment = socialSnapshot?.newsSentiment ?? env.MACRO_NEWS_SENTIMENT;
  const optionalEnrichmentHealthy = !lite ? Boolean(socialSnapshot || futuresIntel) : true;
  const macroHighImpactNews = env.MACRO_HIGH_IMPACT_NEWS;
  const macroUncertaintyLevel = env.MACRO_UNCERTAINTY_LEVEL;
  const btcDominanceBias = env.MACRO_BTC_DOMINANCE_BIAS;
  const socialSentimentScore = socialSnapshot?.socialSentimentScore ?? 50;

  const marketRegime = detectMarketRegime({
    trendStrength,
    momentumPercent,
    shortMomentumPercent,
    volumeSpikePercent,
    pumpIntensity,
    pumpRisk,
    volatilityPercent,
    spreadPercent,
    fakeSpikeScore,
    volume24h: effectiveLiquidity24h,
    minVolumeThreshold: env.SCANNER_MIN_VOLUME_24H,
    shortFlowImbalance,
    newsSentiment: macroNewsSentiment,
    socialSentimentScore,
    btcDominanceBias,
    futuresRiskScore: futuresIntel?.futuresRiskScore,
    leverageStressScore: futuresIntel?.leverageStressScore,
    squeezeProbability: futuresIntel?.squeezeProbability,
    leveragedTrapProbability: futuresIntel?.leveragedTrapProbability,
    oiPriceDivergenceScore: futuresIntel?.oiPriceDivergenceScore,
    manipulationPressureScore: futuresIntel?.manipulationPressureScore,
    futuresIntent: futuresIntel?.futuresIntent,
  });
  const regimeStability = recordRegimeStability({
    symbol: resolvedSymbol,
    marketRegime,
    trendStrength,
    momentumPercent,
    shortMomentumPercent,
    volatilityPercent,
    spreadPercent,
    fakeSpikeScore,
    pumpRisk,
    futuresRiskScore: futuresIntel?.futuresRiskScore,
    leverageStressScore: futuresIntel?.leverageStressScore,
  });
  const stabilityConfidencePenalty = Math.max(
    0,
    regimeStability.transitionProbability * 0.12 +
      regimeStability.flipRisk * 0.1 +
      regimeStability.chaosProbability * 0.08 -
      regimeStability.stabilityScore * 0.06,
  );
  const adjustedRegimeConfidence = Number(
    Math.max(35, Math.min(98, marketRegime.confidenceScore - stabilityConfidencePenalty)).toFixed(2),
  );
  const adjustedRiskMultiplier = Number(
    Math.max(
      0.18,
      Math.min(
        1.18,
        marketRegime.riskMultiplier *
          (regimeStability.stabilityScore >= 72 ? 1.04 : 1) *
          (1 - regimeStability.transitionProbability * 0.0025) *
          (1 - regimeStability.chaosProbability * 0.002),
      ),
    ).toFixed(4),
  );

  const rejectReasons: string[] = [];
  if (options?.forceLive && !liveDataHealthy) rejectReasons.push("Live data unavailable");
  if (!coreMarketDataHealthy) rejectReasons.push("Core market data unavailable");
  if (stalePrice) rejectReasons.push("Market data stale");
  if (tickerOutlier) rejectReasons.push("Ticker outlier filtered");
  if (effectiveLiquidity24h < env.SCANNER_MIN_VOLUME_24H) rejectReasons.push("Low liquidity");
  if (spreadPercent > env.SCANNER_MAX_SPREAD_PERCENT) rejectReasons.push("Spread too wide");
  if (marketRegime.regime === "LOW_VOLUME_DEAD_MARKET" && effectiveLiquidity24h < env.SCANNER_MIN_VOLUME_24H) {
    rejectReasons.push("Low volume regime");
  }
  if (!lite && missingKlines && !liveOrderBook && !liveTrades && !liveKlines) {
    rejectReasons.push("Data quality issue (KLINE_MISSING without deep fallback)");
  }

  const context: MarketContext = {
    symbol: resolvedSymbol,
    lastPrice: effectiveLastPrice,
    change24h,
    volume24h: effectiveLiquidity24h,
    volumeSpikePercent,
    spreadPercent,
    volatilityPercent,
    momentumPercent,
    orderBookImbalance,
    buyPressure,
    shortCandleSignal,
    fakeSpikeScore,
    pumpIntensity,
    pumpRisk,
    tradable:
      isFinitePositive(effectiveLastPrice) &&
      coreMarketDataHealthy &&
      effectiveLiquidity24h >= env.SCANNER_MIN_VOLUME_24H &&
      spreadPercent <= env.SCANNER_MAX_SPREAD_PERCENT,
    rejectReasons,
    metadata: {
      bidDepth: Number(bidDepth.toFixed(4)),
      askDepth: Number(askDepth.toFixed(4)),
      bestBid,
      bestAsk,
      bookMid,
      bookDeviationPercent: Number(bookDeviationPercent.toFixed(4)),
      priceDispersionPercent: Number(priceDispersionPercent.toFixed(4)),
      lastTradeAgeSec,
      lastKlineAgeSec,
      shortWindowSec: windowSec,
      shortTradeCount,
      shortMomentumPercent,
      hourMomentumPercent,
      ema50,
      ema200,
      rsi14,
      dump15mPercent,
      redCandleCount5,
      volumeRatio20,
      atrPercent,
      atrLimitPercent: 3.5,
      high60m: Number(high60m.toFixed(8)),
      low60m: Number(low60m.toFixed(8)),
      distanceFrom60mHighPercent,
      extensionFrom60mLowPercent,
      tradeVelocity,
      shortFlowImbalance,
      volumeSpikePercent,
      pumpIntensity,
      pumpRisk,
      pumpRiskRawScore: pumpRiskComputation.rawScore,
      pumpRiskCapped: pumpRiskComputation.capped,
      pumpRiskStatus: pumpRiskComputation.status,
      pumpRiskReason: pumpRiskComputation.reason,
      pumpRiskSemantics: "computed_formula_v1",
      snapshotTradeNotional: Number(snapshotTradeNotional.toFixed(2)),
      snapshotBookNotional: Number(snapshotBookNotional.toFixed(2)),
      estimatedVolume24h: approxVolume24h,
      volume24hSource: "TICKER",
      effectiveLiquidity24h,
      liveDataHealthy,
      coreMarketDataHealthy,
      tickerHealthy: tickerFresh,
      rollingHistoryHealthy,
      klineHealthy,
      microDataHealthy,
      optionalEnrichmentHealthy,
      liveKlines,
      liveOrderBook,
      liveTrades,
      tickerDeviationPercent: Number(tickerDeviationPercent.toFixed(4)),
      tickerOutlier,
      trendStrength,
      btcDominanceBias,
      socialSentimentScore,
      macroNewsSentiment,
      macroHighImpactNews,
      macroUncertaintyLevel,
      futuresIntent: futuresIntel?.futuresIntent ?? "NEUTRAL",
      futuresRiskScore: futuresIntel?.futuresRiskScore ?? 0,
      futuresRiskSummary: futuresIntel?.summary ?? "Futures intelligence not available",
      leverageStressScore: futuresIntel?.leverageStressScore ?? 0,
      squeezeProbability: futuresIntel?.squeezeProbability ?? 0,
      leveragedTrapProbability: futuresIntel?.leveragedTrapProbability ?? 0,
      positioningPressure: futuresIntel?.positioningPressure ?? 50,
      aggressivePositioningScore: futuresIntel?.aggressivePositioningScore ?? 50,
      oiPriceDivergenceScore: futuresIntel?.oiPriceDivergenceScore ?? 0,
      manipulationPressureScore: futuresIntel?.manipulationPressureScore ?? 0,
      overcrowdedLongScore: futuresIntel?.overcrowdedLongScore ?? 0,
      overcrowdedShortScore: futuresIntel?.overcrowdedShortScore ?? 0,
      fundingRate: futuresIntel?.fundingRate,
      fundingDelta: futuresIntel?.fundingDelta,
      openInterest: futuresIntel?.openInterest,
      openInterestDelta: futuresIntel?.openInterestDelta,
      longShortRatio: futuresIntel?.longShortRatio,
      longShortRatioDelta: futuresIntel?.longShortRatioDelta,
      liquidationImbalance: futuresIntel?.liquidationImbalance,
      liquidationBuyNotional: futuresIntel?.liquidationBuyNotional,
      liquidationSellNotional: futuresIntel?.liquidationSellNotional,
      liquidationMagnetPrice: futuresIntel?.nearestLiquidationMagnetPrice,
      liquidationMagnetDistancePercent: futuresIntel?.liquidationMagnetDistancePercent,
      futuresIntelDegraded: futuresIntel?.degraded ?? true,
      futuresIntelReasons: futuresIntel?.reasons ?? [],
      marketRegime: marketRegime.regime,
      marketRegimeConfidenceScore: adjustedRegimeConfidence,
      marketRegimeRawConfidenceScore: marketRegime.confidenceScore,
      marketRegimeReason: regimeStability.lifecyclePhase === "STABLE"
        ? marketRegime.reason
        : `${marketRegime.reason} Stability=${regimeStability.lifecyclePhase}, transition=${regimeStability.transitionProbability}.`,
      marketRegimeSummary: regimeStability.lifecyclePhase === "STABLE"
        ? marketRegime.marketSummary
        : `${marketRegime.marketSummary} Regime stability: ${regimeStability.lifecyclePhase}.`,
      marketRegimeStrategy: marketRegime.selectedStrategy,
      marketRegimeAllowedStrategies: marketRegime.allowedStrategyTypes,
      marketRegimeForbiddenStrategies: marketRegime.forbiddenStrategyTypes,
      marketRegimeTradingAggressiveness: marketRegime.tradingAggressiveness,
      marketRegimeEntryThresholdScore: marketRegime.entryThresholdScore,
      marketRegimeOpenTradeAllowed: marketRegime.openTradeAllowed,
      marketRegimeTpMultiplier: marketRegime.tpMultiplier,
      marketRegimeSlMultiplier: marketRegime.slMultiplier,
      marketRegimeRiskMultiplier: adjustedRiskMultiplier,
      marketRegimeRawRiskMultiplier: marketRegime.riskMultiplier,
      regimeStabilityScore: regimeStability.stabilityScore,
      regimeAgeSec: regimeStability.regimeAgeSec,
      regimeTransitionProbability: regimeStability.transitionProbability,
      regimeFlipRisk: regimeStability.flipRisk,
      regimeChaosProbability: regimeStability.chaosProbability,
      regimePersistenceScore: regimeStability.persistenceScore,
      regimeSwitchCount10m: regimeStability.switchCount10m,
      regimeLifecyclePhase: regimeStability.lifecyclePhase,
      regimeRapidSwitching: regimeStability.rapidSwitching,
      regimeTrendExhaustion: regimeStability.trendExhaustion,
      regimeVolatilityExpansion: regimeStability.volatilityExpansion,
      regimeVolatilityCompression: regimeStability.volatilityCompression,
      regimeChopWarning: regimeStability.chopWarning,
      regimeFakeTrendTransition: regimeStability.fakeTrendTransition,
      regimeUnstableBreakoutCondition: regimeStability.unstableBreakoutCondition,
      regimeTransitionTimeline: regimeStability.timeline,
      regimeStabilityReasons: regimeStability.reasons,
      liteSnapshot: lite,
      dataQualityIssues,
      dataQualityOk: coreMarketDataHealthy && !stalePrice && !priceAnomaly,
      klineSource,
      klineCount: klines.length,
      daemonKlineCount: bundle.klines1m.length,
      derivedKlineCount: derivedKlines.length,
      rollingEventCount: ringWindow.length,
      rollingWindowMs: ringWindowMs,
      derivedCandlePreview:
        derivedKlines.length > 0
          ? {
              openTime: derivedKlines[derivedKlines.length - 1].openTime,
              open: derivedKlines[derivedKlines.length - 1].open,
              high: derivedKlines[derivedKlines.length - 1].high,
              low: derivedKlines[derivedKlines.length - 1].low,
              close: derivedKlines[derivedKlines.length - 1].close,
              volume: Number(derivedKlines[derivedKlines.length - 1].volume ?? 0),
            }
          : null,
    },
  };

  const degraded =
    ticker.volume24h <= 0 &&
    !hasReliableSnapshotLiquidity &&
    (spreadPercent > env.SCANNER_MAX_SPREAD_PERCENT || rejectReasons.includes("Low liquidity"));
  if (degraded) {
    const cached = getCachedHealthyContext(resolvedSymbol);
    if (cached) {
      return {
        ...cached,
        metadata: {
          ...cached.metadata,
          fallbackFromCache: true,
          fallbackReason: "degraded_live_snapshot",
        },
      };
    }
  }

  rememberContext(context);
  if (options?.allowBackgroundIntelCapture !== false && !options?.signal?.aborted) {
    void import("@/src/server/market-intelligence/market-intelligence-queue")
      .then(({ enqueueMarketIntelJob }) =>
        enqueueMarketIntelJob({
          type: "CAPTURE_SYMBOL",
          symbol: resolvedSymbol,
          interval: "M1",
          captureInput: {
            symbol: resolvedSymbol,
            interval: "M1",
            context,
            klines,
            orderBook,
            recentTrades,
          },
        }),
      )
      .catch(() => null);
  }
  return context;
}
