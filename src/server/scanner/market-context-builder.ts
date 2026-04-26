import { env } from "@/lib/config";
import { getKlines, getOrderBook, getRecentTrades, getTicker } from "@/services/binance.service";
import { putMarketSnapshot } from "@/src/server/scanner/market-snapshot-cache";
import { detectMarketRegime } from "@/src/server/scanner/market-regime.service";
import type { MarketContext } from "@/src/types/scanner";

const CONTEXT_CACHE_TTL_MS = 180_000;
const contextCache = new Map<string, { at: number; context: MarketContext }>();

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

function isFinitePositive(value: number | undefined | null) {
  return Number.isFinite(value) && Number(value) > 0;
}

function hasLiveKlineSignal(closes: number[], volumes: number[]) {
  if (closes.length < 20) return false;
  const positiveVolumes = volumes.filter((x) => x > 0).length;
  return positiveVolumes >= Math.max(3, Math.floor(volumes.length * 0.08));
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

function getCachedHealthyContext(symbol: string) {
  const cached = contextCache.get(symbol);
  if (!cached) return null;
  if (Date.now() - cached.at > CONTEXT_CACHE_TTL_MS) return null;
  return cached.context;
}

function rememberContext(context: MarketContext) {
  const healthy =
    context.volume24h >= env.SCANNER_MIN_VOLUME_24H &&
    context.spreadPercent <= env.SCANNER_MAX_SPREAD_PERCENT * 1.35;
  if (!healthy) return;
  contextCache.set(context.symbol, { at: Date.now(), context });
}

export async function buildMarketContext(symbol: string): Promise<MarketContext> {
  const normalized = symbol.toUpperCase();
  const ticker = await getTicker(normalized);
  const resolvedSymbol = ticker.symbol.toUpperCase();
  const safeTickerPrice = Number.isFinite(ticker.price) && ticker.price > 0 ? ticker.price : 1;
  const safeTickerVolume = Number.isFinite(ticker.volume24h) && ticker.volume24h > 0 ? ticker.volume24h : 0;
  const [klinesRes, orderBookRes, recentTradesRes] = await Promise.allSettled([
    getKlines(resolvedSymbol, "1m", 80),
    getOrderBook(resolvedSymbol, 30),
    getRecentTrades(resolvedSymbol, 150),
  ]);
  const klines = klinesRes.status === "fulfilled" && klinesRes.value.length > 0 ? klinesRes.value : fallbackKlines(safeTickerPrice, 80);
  const orderBook =
    orderBookRes.status === "fulfilled" && orderBookRes.value.bids.length > 0 && orderBookRes.value.asks.length > 0
      ? orderBookRes.value
      : {
          lastUpdateId: Date.now(),
          bids: [{ price: safeTickerPrice, quantity: 0 }],
          asks: [{ price: safeTickerPrice, quantity: 0 }],
        };
  const recentTrades =
    recentTradesRes.status === "fulfilled" && recentTradesRes.value.length > 0
      ? recentTradesRes.value
      : fallbackRecentTrades(safeTickerPrice, 150);

  putMarketSnapshot(resolvedSymbol, { klines, orderBook, recentTrades });

  const closes = klines.map((x) => x.close);
  const volumes = klines.map((x) => Number(x.volume ?? 0));
  const liveKlines = hasLiveKlineSignal(closes, volumes);
  const liveOrderBook = hasLiveOrderBookSignal(orderBook.bids, orderBook.asks);
  const liveTrades = hasLiveTradesSignal(recentTrades);
  const liveDataHealthy = liveKlines || liveOrderBook || liveTrades;

  const latestClose = closes[closes.length - 1];
  const latestTradePrice = recentTrades[recentTrades.length - 1]?.price;
  const bestBidCandidate = orderBook.bids[0]?.price;
  const bestAskCandidate = orderBook.asks[0]?.price;
  const bookMid =
    isFinitePositive(bestBidCandidate) && isFinitePositive(bestAskCandidate)
      ? Number((((bestBidCandidate + bestAskCandidate) / 2)).toFixed(8))
      : undefined;
  const priceCandidates = [safeTickerPrice, latestClose, latestTradePrice, bookMid]
    .filter((x): x is number => isFinitePositive(x))
    .map((x) => Number(x.toFixed(8)));
  const trustedPrice = priceCandidates.length > 0 ? median(priceCandidates) : safeTickerPrice;
  const tickerDeviationPercent =
    trustedPrice > 0 ? Math.abs((safeTickerPrice - trustedPrice) / trustedPrice) * 100 : 0;
  const tickerOutlier = priceCandidates.length >= 2 && tickerDeviationPercent >= 35;
  const effectiveLastPrice = tickerOutlier ? trustedPrice : safeTickerPrice;

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

  const snapshotTradeNotional = buyPressureVol + sellPressureVol;
  const snapshotBookNotional = bidDepth + askDepth;
  const snapshotNotional = Math.max(snapshotTradeNotional, snapshotBookNotional);
  const snapshotMinLiquidity = Math.max(10_000, env.SCANNER_MIN_VOLUME_24H * 0.02);
  const hasReliableSnapshotLiquidity = snapshotNotional >= snapshotMinLiquidity;
  const effectiveLiquidity24h =
    ticker.volume24h >= env.SCANNER_MIN_VOLUME_24H
      ? safeTickerVolume
      : hasReliableSnapshotLiquidity
        ? Number(snapshotNotional.toFixed(2))
        : safeTickerVolume;

  const shortCandleSignal = klines.slice(-4).reduce((acc, row) => {
    const body = row.close - row.open;
    return acc + (body > 0 ? 1 : -1);
  }, 0);

  const fakeSpikeScore = Number(
    (
      Math.max(0, Math.abs(momentumPercent) - 1.2) *
      (spreadPercent > env.SCANNER_MAX_SPREAD_PERCENT ? 1.8 : 1) *
      (effectiveLiquidity24h < env.SCANNER_MIN_VOLUME_24H ? 1.6 : 1)
    ).toFixed(4),
  );

  const marketRegime = detectMarketRegime({
    trendStrength,
    momentumPercent,
    shortMomentumPercent,
    volatilityPercent,
    spreadPercent,
    fakeSpikeScore,
    volume24h: effectiveLiquidity24h,
    minVolumeThreshold: env.SCANNER_MIN_VOLUME_24H,
    shortFlowImbalance,
    newsSentiment: "NEUTRAL",
    socialSentimentScore: 50,
    btcDominanceBias: 0,
  });

  const rejectReasons: string[] = [];
  if (!liveDataHealthy) rejectReasons.push("Market data degraded");
  if (tickerOutlier) rejectReasons.push("Ticker outlier filtered");
  if (effectiveLiquidity24h < env.SCANNER_MIN_VOLUME_24H) rejectReasons.push("Low liquidity");
  if (spreadPercent > env.SCANNER_MAX_SPREAD_PERCENT) rejectReasons.push("Spread too wide");
  if (marketRegime.regime === "LOW_VOLUME_DEAD_MARKET") rejectReasons.push("Low volume regime");

  const context: MarketContext = {
    symbol: resolvedSymbol,
    lastPrice: effectiveLastPrice,
    change24h: ticker.change24h,
    volume24h: effectiveLiquidity24h,
    spreadPercent,
    volatilityPercent,
    momentumPercent,
    orderBookImbalance,
    buyPressure,
    shortCandleSignal,
    fakeSpikeScore,
    tradable: rejectReasons.length === 0,
    rejectReasons,
    metadata: {
      bidDepth: Number(bidDepth.toFixed(4)),
      askDepth: Number(askDepth.toFixed(4)),
      bestBid,
      bestAsk,
      shortWindowSec: windowSec,
      shortTradeCount,
      shortMomentumPercent,
      tradeVelocity,
      shortFlowImbalance,
      snapshotTradeNotional: Number(snapshotTradeNotional.toFixed(2)),
      snapshotBookNotional: Number(snapshotBookNotional.toFixed(2)),
      effectiveLiquidity24h,
      liveDataHealthy,
      liveKlines,
      liveOrderBook,
      liveTrades,
      tickerDeviationPercent: Number(tickerDeviationPercent.toFixed(4)),
      tickerOutlier,
      trendStrength,
      marketRegime: marketRegime.regime,
      marketRegimeConfidenceScore: marketRegime.confidenceScore,
      marketRegimeReason: marketRegime.reason,
      marketRegimeSummary: marketRegime.marketSummary,
      marketRegimeStrategy: marketRegime.selectedStrategy,
      marketRegimeAllowedStrategies: marketRegime.allowedStrategyTypes,
      marketRegimeForbiddenStrategies: marketRegime.forbiddenStrategyTypes,
      marketRegimeTradingAggressiveness: marketRegime.tradingAggressiveness,
      marketRegimeEntryThresholdScore: marketRegime.entryThresholdScore,
      marketRegimeOpenTradeAllowed: marketRegime.openTradeAllowed,
      marketRegimeTpMultiplier: marketRegime.tpMultiplier,
      marketRegimeSlMultiplier: marketRegime.slMultiplier,
      marketRegimeRiskMultiplier: marketRegime.riskMultiplier,
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
  return context;
}
