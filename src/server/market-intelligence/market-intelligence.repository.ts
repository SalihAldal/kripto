import { gzipSync } from "node:zlib";
import type { Prisma, SnapshotInterval } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { CompleteMarketState } from "@/src/server/market-intelligence/market-intelligence.types";

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

export async function ensureTradingPair(symbol: string) {
  const normalized = symbol.toUpperCase();
  const existing = await prisma.tradingPair.findUnique({ where: { symbol: normalized } });
  if (existing) return existing;
  const quote = normalized.endsWith("USDT") ? "USDT" : normalized.slice(-3);
  const base = normalized.replace(quote, "");
  return prisma.tradingPair.create({
    data: { symbol: normalized, baseAsset: base || normalized, quoteAsset: quote },
  });
}

export async function persistCompleteMarketState(input: {
  symbol: string;
  interval: SnapshotInterval;
  snapshotAt: Date;
  state: CompleteMarketState;
  sourceLatencyMs?: number;
  compressedPayload?: Record<string, unknown>;
}) {
  const pair = await ensureTradingPair(input.symbol);
  const m = input.state.snapshot;
  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.marketSnapshot.create({
      data: {
        tradingPairId: pair.id,
        symbol: input.symbol.toUpperCase(),
        interval: input.interval,
        snapshotAt: input.snapshotAt,
        bidPrice: m.bid,
        askPrice: m.ask,
        lastPrice: m.close,
        open: m.open,
        high: m.high,
        low: m.low,
        close: m.close,
        volumeBase: m.volumeBase,
        volumeQuote: m.volumeQuote,
        tradeCount: m.tradeCount,
        vwap: m.vwap,
        atr: m.atr,
        trueRange: m.trueRange,
        spread: m.spread,
        bidAskRatio: m.bidAskRatio,
        orderBookImbalance: m.orderBookImbalance,
        liquidityScore: m.liquidityScore,
        effectiveLiquidity: m.effectiveLiquidity,
        fundingRate: m.fundingRate ?? undefined,
        openInterest: m.openInterest ?? undefined,
        longShortRatio: m.longShortRatio ?? undefined,
        liquidationVolume: m.liquidationVolume ?? undefined,
        whaleActivity: m.whaleActivity,
        whaleBuyVolume: m.whaleBuyVolume,
        whaleSellVolume: m.whaleSellVolume,
        aggressiveBuyPct: m.aggressiveBuyPct,
        aggressiveSellPct: m.aggressiveSellPct,
        netFlow: m.netFlow,
        volumeDelta: m.volumeDelta,
        cvd: m.cvd,
        relativeVolume: m.relativeVolume,
        marketCap: m.marketCap ?? undefined,
        fdv: m.fdv ?? undefined,
        dominance: m.dominance ?? undefined,
        volatility: m.volatility,
        realizedVolatility: m.realizedVolatility,
        impliedVolatility: m.impliedVolatility ?? undefined,
        correlationBtc: m.correlationBtc ?? undefined,
        correlationEth: m.correlationEth ?? undefined,
        relativeStrength: m.relativeStrength ?? undefined,
        regime: m.regime,
        healthScore: m.healthScore,
        dataQualityScore: m.dataQualityScore,
        compressedPayload: asJson(input.compressedPayload),
        sourceLatencyMs: input.sourceLatencyMs,
      },
    });

    await tx.marketTrend.create({
      data: { snapshotId: snapshot.id, symbol: input.symbol.toUpperCase(), ...input.state.trend },
    });
    await tx.marketMomentum.create({
      data: { snapshotId: snapshot.id, symbol: input.symbol.toUpperCase(), ...input.state.momentum },
    });
    await tx.marketHealth.create({
      data: { snapshotId: snapshot.id, symbol: input.symbol.toUpperCase(), ...input.state.health },
    });
    await tx.marketLiquidity.create({
      data: {
        snapshotId: snapshot.id,
        symbol: input.symbol.toUpperCase(),
        ...input.state.liquidity,
      },
    });
    await tx.marketVolume.create({
      data: {
        snapshotId: snapshot.id,
        symbol: input.symbol.toUpperCase(),
        volumeProfile: asJson(input.state.volume.volumeProfile),
        volumeDelta: input.state.volume.volumeDelta,
        relativeVolume: input.state.volume.relativeVolume,
        abnormalVolume: input.state.volume.abnormalVolume,
        smartMoneyVolume: input.state.volume.smartMoneyVolume,
        retailVolume: input.state.volume.retailVolume,
        whaleVolume: input.state.volume.whaleVolume,
        buyingPressure: input.state.volume.buyingPressure,
        sellingPressure: input.state.volume.sellingPressure,
      },
    });

    return snapshot;
  });
}

export function compressMarketState(state: CompleteMarketState) {
  const raw = JSON.stringify(state);
  const compressed = gzipSync(Buffer.from(raw, "utf8")).toString("base64");
  return { rawBytes: raw.length, compressed, ratio: Number((compressed.length / raw.length).toFixed(4)) };
}

export async function archiveSnapshotHistory(input: {
  snapshotId: string;
  symbol: string;
  interval: SnapshotInterval;
  snapshotAt: Date;
  compressedData: Record<string, unknown>;
  retentionTier: string;
}) {
  return prisma.snapshotHistory.create({
    data: {
      snapshotId: input.snapshotId,
      symbol: input.symbol.toUpperCase(),
      interval: input.interval,
      snapshotAt: input.snapshotAt,
      compressedData: asJson(input.compressedData)!,
      retentionTier: input.retentionTier,
    },
  });
}

export async function getLatestSnapshot(symbol: string, interval?: SnapshotInterval) {
  return prisma.marketSnapshot.findFirst({
    where: { symbol: symbol.toUpperCase(), interval: interval ?? undefined },
    orderBy: { snapshotAt: "desc" },
    include: { trend: true, momentum: true, health: true, liquidity: true, volumeIntel: true },
  });
}

export async function getSnapshotTimeline(input: {
  symbol: string;
  interval?: SnapshotInterval;
  since?: Date;
  until?: Date;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(2000, input.limit ?? 500));
  return prisma.marketSnapshot.findMany({
    where: {
      symbol: input.symbol.toUpperCase(),
      interval: input.interval,
      snapshotAt: {
        gte: input.since,
        lte: input.until,
      },
    },
    orderBy: { snapshotAt: "asc" },
    take: limit,
    include: { trend: true, momentum: true, health: true },
  });
}

export async function deleteSnapshotsBefore(interval: SnapshotInterval, before: Date) {
  const rows = await prisma.marketSnapshot.findMany({
    where: { interval, snapshotAt: { lt: before } },
    select: { id: true },
    take: 5000,
  });
  if (rows.length === 0) return 0;
  await prisma.marketSnapshot.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.length;
}

export async function upsertSnapshotReplay(input: {
  symbol: string;
  replayAt: Date;
  interval: SnapshotInterval;
  snapshotId?: string;
  payload: Record<string, unknown>;
}) {
  return prisma.snapshotReplay.upsert({
    where: {
      symbol_replayAt_interval: {
        symbol: input.symbol.toUpperCase(),
        replayAt: input.replayAt,
        interval: input.interval,
      },
    },
    create: {
      symbol: input.symbol.toUpperCase(),
      replayAt: input.replayAt,
      interval: input.interval,
      snapshotId: input.snapshotId,
      payload: asJson(input.payload)!,
    },
    update: {
      snapshotId: input.snapshotId,
      payload: asJson(input.payload)!,
    },
  });
}

export async function findSnapshotNearTime(symbol: string, target: Date, interval: SnapshotInterval = "M1") {
  const windowMs = 90_000;
  return prisma.marketSnapshot.findFirst({
    where: {
      symbol: symbol.toUpperCase(),
      interval,
      snapshotAt: { gte: new Date(target.getTime() - windowMs), lte: new Date(target.getTime() + windowMs) },
    },
    orderBy: { snapshotAt: "desc" },
    include: { trend: true, momentum: true, health: true, liquidity: true, volumeIntel: true },
  });
}
