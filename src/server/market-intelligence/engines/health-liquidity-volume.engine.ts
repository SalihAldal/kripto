import type { OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";
import { clamp } from "@/src/server/market-intelligence/engines/regime-trend-momentum.engine";

export function computeHealthIntel(input: {
  liquidityScore: number;
  spreadPct: number;
  volatilityPct: number;
  dataQualityScore: number;
  orderbookStability: number;
  marketStability: number;
  newsImpact: number;
  fundingStability: number;
  exchangeHealth: number;
}) {
  const spreadScore = clamp(100 - input.spreadPct * 400, 0, 100);
  const volatilityScore = clamp(100 - Math.abs(input.volatilityPct - 1) * 25, 0, 100);
  const executionQuality = clamp((spreadScore + input.liquidityScore + input.orderbookStability) / 3, 0, 100);
  const healthScore = Number(
    (
      input.liquidityScore * 0.18 +
      spreadScore * 0.12 +
      volatilityScore * 0.1 +
      input.dataQualityScore * 0.15 +
      executionQuality * 0.12 +
      input.orderbookStability * 0.1 +
      input.marketStability * 0.08 +
      (100 - input.newsImpact) * 0.05 +
      input.fundingStability * 0.05 +
      input.exchangeHealth * 0.05
    ).toFixed(2),
  );
  return {
    healthScore,
    liquidityScore: input.liquidityScore,
    spreadScore: Number(spreadScore.toFixed(2)),
    volatilityScore: Number(volatilityScore.toFixed(2)),
    dataQualityScore: input.dataQualityScore,
    executionQuality: Number(executionQuality.toFixed(2)),
    orderbookStability: input.orderbookStability,
    marketStability: input.marketStability,
    newsImpact: input.newsImpact,
    fundingStability: input.fundingStability,
    exchangeHealth: input.exchangeHealth,
  };
}

export function computeLiquidityIntel(input: {
  orderBook: OrderBookSnapshot;
  lastPrice: number;
  spreadPct: number;
  recentTrades: RecentTrade[];
}) {
  const bidDepth = input.orderBook.bids.reduce((s, b) => s + b.price * b.quantity, 0);
  const askDepth = input.orderBook.asks.reduce((s, a) => s + a.price * a.quantity, 0);
  const totalDepth = bidDepth + askDepth;
  const depthScore = clamp(Math.log10(Math.max(totalDepth, 1)) * 20, 0, 100);
  const spreadScore = clamp(100 - input.spreadPct * 350, 0, 100);
  const liquidityScore = Number(((depthScore * 0.65 + spreadScore * 0.35)).toFixed(2));
  const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;
  const largeTrades = input.recentTrades.filter((t) => t.price * t.qty >= input.lastPrice * 50);
  const sweepDetected = largeTrades.length >= 3 && Math.abs(imbalance) > 0.25;
  const topBid = input.orderBook.bids[0]?.quantity ?? 0;
  const topAsk = input.orderBook.asks[0]?.quantity ?? 0;
  const liquidityWall = Math.max(topBid, topAsk) * input.lastPrice;
  const repeatedSizes = new Map<number, number>();
  for (const t of input.recentTrades.slice(0, 40)) {
    const key = Math.round(t.qty * 1000);
    repeatedSizes.set(key, (repeatedSizes.get(key) ?? 0) + 1);
  }
  const spoofDetected = [...repeatedSizes.values()].some((count) => count >= 6);
  const icebergDetected = input.recentTrades.some((t) => t.qty > 0 && t.qty === input.recentTrades[0]?.qty);
  const absorption = clamp(Math.abs(imbalance) * 100, 0, 100);
  return {
    liquidityScore,
    depthScore: Number(depthScore.toFixed(2)),
    spreadScore: Number(spreadScore.toFixed(2)),
    absorption: Number(absorption.toFixed(2)),
    sweepDetected,
    liquidityWall: Number(liquidityWall.toFixed(2)),
    spoofDetected,
    icebergDetected,
  };
}

export function computeVolumeIntel(input: {
  recentTrades: RecentTrade[];
  klineVolumes: number[];
  volume24h: number;
  whaleThreshold: number;
}) {
  let buyVol = 0;
  let sellVol = 0;
  let whaleBuy = 0;
  let whaleSell = 0;
  for (const trade of input.recentTrades) {
    const notional = trade.price * trade.qty;
    if (trade.isBuyerMaker) sellVol += notional;
    else buyVol += notional;
    if (notional >= input.whaleThreshold) {
      if (trade.isBuyerMaker) whaleSell += notional;
      else whaleBuy += notional;
    }
  }
  const total = buyVol + sellVol;
  const volumeDelta = buyVol - sellVol;
  const avgBar = input.klineVolumes.length > 0 ? input.klineVolumes.reduce((s, v) => s + v, 0) / input.klineVolumes.length : 0;
  const lastBar = input.klineVolumes.at(-1) ?? 0;
  const relativeVolume = avgBar > 0 ? lastBar / avgBar : 1;
  const abnormalVolume = relativeVolume >= 2.5;
  const profile = {
    buyVolume: Number(buyVol.toFixed(2)),
    sellVolume: Number(sellVol.toFixed(2)),
    avgBarVolume: Number(avgBar.toFixed(2)),
    lastBarVolume: Number(lastBar.toFixed(2)),
  };
  return {
    volumeProfile: profile,
    volumeDelta: Number(volumeDelta.toFixed(2)),
    relativeVolume: Number(relativeVolume.toFixed(4)),
    abnormalVolume,
    smartMoneyVolume: Number((whaleBuy + whaleSell).toFixed(2)),
    retailVolume: Number(Math.max(0, total - whaleBuy - whaleSell).toFixed(2)),
    whaleVolume: Number((whaleBuy + whaleSell).toFixed(2)),
    buyingPressure: total > 0 ? Number(((buyVol / total) * 100).toFixed(2)) : 50,
    sellingPressure: total > 0 ? Number(((sellVol / total) * 100).toFixed(2)) : 50,
    whaleBuyVolume: Number(whaleBuy.toFixed(2)),
    whaleSellVolume: Number(whaleSell.toFixed(2)),
  };
}

export function computeCoreMetrics(input: {
  klines: import("@/src/types/exchange").KlineItem[];
  orderBook: OrderBookSnapshot;
  recentTrades: RecentTrade[];
  lastPrice: number;
  spreadPct: number;
  volume24h: number;
  volatilityPct: number;
  metadata: Record<string, unknown>;
  fundingRate?: number | null;
  openInterest?: number | null;
  longShortRatio?: number | null;
  correlationBtc?: number | null;
  correlationEth?: number | null;
  relativeStrength?: number | null;
  regime: import("@prisma/client").MarketIntelRegime;
  healthScore: number;
  dataQualityScore: number;
}) {
  const last = input.klines.at(-1);
  const prev = input.klines.at(-2);
  const tr = last && prev ? Math.max(last.high - last.low, Math.abs(last.high - prev.close), Math.abs(last.low - prev.close)) : last ? last.high - last.low : 0;
  const atrPeriod = 14;
  const trs: number[] = [];
  for (let i = 1; i < input.klines.length; i += 1) {
    const c = input.klines[i]!;
    const p = input.klines[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atr = trs.slice(-atrPeriod).reduce((s, v) => s + v, 0) / Math.max(Math.min(atrPeriod, trs.length), 1);
  const bid = input.orderBook.bids[0]?.price ?? input.lastPrice;
  const ask = input.orderBook.asks[0]?.price ?? input.lastPrice;
  const bidDepth = input.orderBook.bids.reduce((s, b) => s + b.price * b.quantity, 0);
  const askDepth = input.orderBook.asks.reduce((s, a) => s + a.price * a.quantity, 0);
  const totalDepth = bidDepth + askDepth;
  const imbalance = totalDepth > 0 ? (bidDepth - askDepth) / totalDepth : 0;
  let buyVol = 0;
  let sellVol = 0;
  let cvd = 0;
  for (const t of input.recentTrades) {
    const n = t.price * t.qty;
    if (t.isBuyerMaker) {
      sellVol += n;
      cvd -= t.qty;
    } else {
      buyVol += n;
      cvd += t.qty;
    }
  }
  const totalFlow = buyVol + sellVol;
  const whaleThreshold = input.lastPrice * 100;
  const whaleTrades = input.recentTrades.filter((t) => t.price * t.qty >= whaleThreshold);
  const vwap =
    input.klines.length > 0
      ? input.klines.reduce((s, k) => s + ((k.high + k.low + k.close) / 3) * k.volume, 0) /
        Math.max(input.klines.reduce((s, k) => s + k.volume, 0), 1e-9)
      : input.lastPrice;
  return {
    open: last?.open ?? input.lastPrice,
    high: last?.high ?? input.lastPrice,
    low: last?.low ?? input.lastPrice,
    close: last?.close ?? input.lastPrice,
    volumeBase: last?.volume ?? 0,
    volumeQuote: (last?.volume ?? 0) * input.lastPrice,
    tradeCount: input.recentTrades.length,
    vwap: Number(vwap.toFixed(6)),
    atr: Number(atr.toFixed(6)),
    trueRange: Number(tr.toFixed(6)),
    spread: Number(input.spreadPct.toFixed(6)),
    bid,
    ask,
    bidAskRatio: ask > 0 ? Number((bid / ask).toFixed(4)) : 1,
    orderBookImbalance: Number(imbalance.toFixed(4)),
    liquidityScore: clamp(Math.log10(Math.max(totalDepth, 1)) * 18, 0, 100),
    effectiveLiquidity: Number(totalDepth.toFixed(2)),
    fundingRate: input.fundingRate ?? null,
    openInterest: input.openInterest ?? null,
    longShortRatio: input.longShortRatio ?? null,
    liquidationVolume: Number(input.metadata.liquidationVolume ?? 0) || null,
    whaleActivity: whaleTrades.length,
    whaleBuyVolume: Number(whaleTrades.filter((t) => !t.isBuyerMaker).reduce((s, t) => s + t.price * t.qty, 0).toFixed(2)),
    whaleSellVolume: Number(whaleTrades.filter((t) => t.isBuyerMaker).reduce((s, t) => s + t.price * t.qty, 0).toFixed(2)),
    aggressiveBuyPct: totalFlow > 0 ? Number(((buyVol / totalFlow) * 100).toFixed(2)) : 50,
    aggressiveSellPct: totalFlow > 0 ? Number(((sellVol / totalFlow) * 100).toFixed(2)) : 50,
    netFlow: Number((buyVol - sellVol).toFixed(2)),
    volumeDelta: Number((buyVol - sellVol).toFixed(2)),
    cvd: Number(cvd.toFixed(4)),
    relativeVolume: Number((input.metadata.volumeSpikeRatio ?? input.metadata.volumeSpikePercent ?? 1) as number),
    marketCap: Number(input.metadata.marketCap ?? 0) || null,
    fdv: Number(input.metadata.fdv ?? 0) || null,
    dominance: Number(input.metadata.btcDominanceBias ?? 0) || null,
    volatility: input.volatilityPct,
    realizedVolatility: input.volatilityPct,
    impliedVolatility: Number(input.metadata.impliedVolatility ?? 0) || null,
    correlationBtc: input.correlationBtc ?? null,
    correlationEth: input.correlationEth ?? null,
    relativeStrength: input.relativeStrength ?? null,
    regime: input.regime,
    healthScore: input.healthScore,
    dataQualityScore: input.dataQualityScore,
  };
}
