import type { SnapshotInterval } from "@prisma/client";
import { getKlines } from "@/services/binance.service";
import {
  classifyMarketRegime,
  computeCorrelations,
  computeMomentumIntel,
  computeTrendIntel,
} from "@/src/server/market-intelligence/engines/regime-trend-momentum.engine";
import {
  computeCoreMetrics,
  computeHealthIntel,
  computeLiquidityIntel,
  computeVolumeIntel,
} from "@/src/server/market-intelligence/engines/health-liquidity-volume.engine";
import type { CompleteMarketState, MarketCaptureInput } from "@/src/server/market-intelligence/market-intelligence.types";
import {
  archiveSnapshotHistory,
  compressMarketState,
  persistCompleteMarketState,
} from "@/src/server/market-intelligence/market-intelligence.repository";

const INTERVAL_KLINE: Record<string, { binance: string; limit: number }> = {
  M1: { binance: "1m", limit: 80 },
  M3: { binance: "3m", limit: 80 },
  M5: { binance: "5m", limit: 80 },
  M15: { binance: "15m", limit: 80 },
  M30: { binance: "30m", limit: 80 },
  H1: { binance: "1h", limit: 80 },
  H4: { binance: "4h", limit: 80 },
  D1: { binance: "1d", limit: 80 },
};

export function buildCompleteMarketState(input: MarketCaptureInput): CompleteMarketState {
  const md = input.context.metadata;
  const trend = computeTrendIntel(input.klines);
  const momentum = computeMomentumIntel(input.klines, input.context.momentumPercent);
  const liquidity = computeLiquidityIntel({
    orderBook: input.orderBook,
    lastPrice: input.context.lastPrice,
    spreadPct: input.context.spreadPercent,
    recentTrades: input.recentTrades,
  });
  const volume = computeVolumeIntel({
    recentTrades: input.recentTrades,
    klineVolumes: input.klines.map((k) => k.volume),
    volume24h: input.context.volume24h,
    whaleThreshold: input.context.lastPrice * 100,
  });
  const dataQualityScore = Boolean(md.dataQualityOk ?? md.liveDataHealthy ?? true) ? 85 : 45;
  const newsImpact = Number(md.macroUncertaintyLevel ?? md.macroHighImpactNews ? 70 : 20);
  const fundingStability = 100 - Math.min(100, Math.abs(Number(md.fundingRate ?? 0)) * 10_000);
  const healthPartial = computeHealthIntel({
    liquidityScore: liquidity.liquidityScore,
    spreadPct: input.context.spreadPercent,
    volatilityPct: input.context.volatilityPercent,
    dataQualityScore,
    orderbookStability: 100 - Math.abs(liquidity.absorption - 50),
    marketStability: 100 - Math.min(100, input.context.fakeSpikeScore * 20),
    newsImpact,
    fundingStability,
    exchangeHealth: 90,
  });
  const correlations = computeCorrelations({
    assetCloses: input.klines.map((k) => k.close),
    btcCloses: input.btcKlines?.map((k) => k.close),
    ethCloses: input.ethKlines?.map((k) => k.close),
  });
  const regime = classifyMarketRegime({
    trendStrength: trend.trendStrength,
    momentumPct: input.context.momentumPercent,
    volatilityPct: input.context.volatilityPercent,
    spreadPct: input.context.spreadPercent,
    volumeSpike: input.context.volumeSpikePercent,
    pumpIntensity: input.context.pumpIntensity,
    fakeSpikeScore: input.context.fakeSpikeScore,
    newsImpact,
    fundingRate: Number(md.fundingRate ?? 0),
    longShortRatio: Number(md.longShortRatio ?? 1),
    orderBookImbalance: input.context.orderBookImbalance,
  });
  const snapshot = computeCoreMetrics({
    klines: input.klines,
    orderBook: input.orderBook,
    recentTrades: input.recentTrades,
    lastPrice: input.context.lastPrice,
    spreadPct: input.context.spreadPercent,
    volume24h: input.context.volume24h,
    volatilityPct: input.context.volatilityPercent,
    metadata: md,
    fundingRate: Number(md.fundingRate ?? 0) || null,
    openInterest: Number(md.openInterest ?? 0) || null,
    longShortRatio: Number(md.longShortRatio ?? 0) || null,
    correlationBtc: correlations.correlationBtc,
    correlationEth: correlations.correlationEth,
    relativeStrength: correlations.relativeStrength,
    regime,
    healthScore: healthPartial.healthScore,
    dataQualityScore,
  });
  return {
    snapshot: snapshot,
    trend,
    momentum,
    health: healthPartial,
    liquidity,
    volume: {
      ...volume,
      volumeProfile: volume.volumeProfile,
    },
  };
}

export async function captureMarketSnapshot(input: MarketCaptureInput) {
  const started = Date.now();
  const state = buildCompleteMarketState(input);
  const compressed = compressMarketState(state);
  const snapshot = await persistCompleteMarketState({
    symbol: input.symbol,
    interval: input.interval,
    snapshotAt: input.snapshotAt ?? new Date(),
    state,
    sourceLatencyMs: Date.now() - started,
    compressedPayload: compressed,
  });
  await archiveSnapshotHistory({
    snapshotId: snapshot.id,
    symbol: input.symbol,
    interval: input.interval,
    snapshotAt: snapshot.snapshotAt,
    compressedData: compressed,
    retentionTier: input.interval,
  }).catch(() => null);
  return { snapshotId: snapshot.id, state, compressed };
}

export async function captureMarketSnapshotFromSymbol(input: {
  symbol: string;
  interval?: SnapshotInterval;
  context?: MarketCaptureInput["context"];
  klines?: MarketCaptureInput["klines"];
  orderBook?: MarketCaptureInput["orderBook"];
  recentTrades?: MarketCaptureInput["recentTrades"];
}) {
  const interval = input.interval ?? "M1";
  const spec = INTERVAL_KLINE[interval] ?? INTERVAL_KLINE.M1!;
  const [klines, btcKlines, ethKlines] = await Promise.all([
    input.klines ? Promise.resolve(input.klines) : getKlines(input.symbol, spec.binance, spec.limit).catch(() => []),
    getKlines("BTCUSDT", spec.binance, spec.limit).catch(() => []),
    getKlines("ETHUSDT", spec.binance, spec.limit).catch(() => []),
  ]);
  if (!input.context || !input.orderBook || !input.recentTrades) {
    const { buildMarketContext } = await import("@/src/server/scanner/market-context-builder");
    const context = input.context ?? (await buildMarketContext(input.symbol, { lite: true }));
    const { getMarketSnapshot } = await import("@/src/server/scanner/market-snapshot-cache");
    const cached = getMarketSnapshot(input.symbol);
    return captureMarketSnapshot({
      symbol: input.symbol,
      interval,
      context,
      klines: klines.length > 0 ? klines : cached?.klines ?? [],
      orderBook: input.orderBook ?? cached?.orderBook ?? { lastUpdateId: 0, bids: [], asks: [] },
      recentTrades: input.recentTrades ?? cached?.recentTrades ?? [],
      btcKlines,
      ethKlines,
    });
  }
  return captureMarketSnapshot({
    symbol: input.symbol,
    interval,
    context: input.context,
    klines,
    orderBook: input.orderBook,
    recentTrades: input.recentTrades,
    btcKlines,
    ethKlines,
  });
}
