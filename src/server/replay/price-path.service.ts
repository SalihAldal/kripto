import { getKlines } from "@/services/binance.service";
import { prisma } from "@/src/server/db/prisma";
import { REPLAY_HORIZONS, type PriceCandle, type PricePathResult } from "@/src/server/replay/replay.types";

function pctChange(from: number, to: number) {
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

function mergeCandles(rows: PriceCandle[]) {
  const map = new Map<number, PriceCandle>();
  for (const row of rows) {
    map.set(row.openTime, row);
  }
  return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
}

async function loadMarketSnapshotPrices(symbol: string, from: Date, to: Date) {
  const pair = await prisma.tradingPair.findFirst({
    where: { symbol: symbol.toUpperCase() },
    select: { id: true },
  });
  if (!pair) return [] as PriceCandle[];

  const rows = await prisma.marketSnapshot.findMany({
    where: {
      tradingPairId: pair.id,
      snapshotAt: { gte: from, lte: to },
    },
    orderBy: { snapshotAt: "asc" },
    take: 10_000,
  });

  return rows.map((row) => ({
    openTime: row.snapshotAt.getTime(),
    closeTime: row.snapshotAt.getTime(),
    open: row.lastPrice,
    high: Math.max(row.lastPrice, row.askPrice, row.bidPrice),
    low: Math.min(row.lastPrice, row.askPrice, row.bidPrice),
    close: row.lastPrice,
    volume: Number(row.volumeQuote ?? row.volumeBase ?? 0),
  }));
}

async function loadTradeEventPrices(symbol: string, from: Date, to: Date) {
  const rows = await prisma.tradeEventLog.findMany({
    where: {
      symbol: symbol.toUpperCase(),
      createdAt: { gte: from, lte: to },
      price: { not: null },
    },
    orderBy: { createdAt: "asc" },
    take: 5_000,
    select: { createdAt: true, price: true },
  });

  return rows
    .filter((row) => Number.isFinite(row.price) && (row.price ?? 0) > 0)
    .map((row) => ({
      openTime: row.createdAt.getTime(),
      closeTime: row.createdAt.getTime(),
      open: row.price!,
      high: row.price!,
      low: row.price!,
      close: row.price!,
      volume: 0,
    }));
}

async function loadRecentKlines(symbol: string, decisionTime: Date, maxHorizonMs: number) {
  const ageMs = Date.now() - decisionTime.getTime();
  if (ageMs > maxHorizonMs + 60 * 60_000) return [] as PriceCandle[];

  const limit = Math.min(1000, Math.ceil((maxHorizonMs + ageMs) / 60_000) + 5);
  const rows = await getKlines(symbol, "1m", limit).catch(() => []);
  const startMs = decisionTime.getTime();
  const endMs = startMs + maxHorizonMs;

  return rows
    .filter((row) => row.openTime >= startMs - 60_000 && row.openTime <= endMs)
    .map((row) => ({
      openTime: row.openTime,
      closeTime: row.closeTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
}

export async function buildPricePath(input: {
  symbol: string;
  decisionTime: Date;
  fallbackPrice?: number | null;
}): Promise<PricePathResult> {
  const maxHorizonMs = REPLAY_HORIZONS[REPLAY_HORIZONS.length - 1]!.ms;
  const endTime = new Date(input.decisionTime.getTime() + maxHorizonMs);

  const [snapshots, events, klines] = await Promise.all([
    loadMarketSnapshotPrices(input.symbol, input.decisionTime, endTime),
    loadTradeEventPrices(input.symbol, input.decisionTime, endTime),
    loadRecentKlines(input.symbol, input.decisionTime, maxHorizonMs),
  ]);

  const candles = mergeCandles([...snapshots, ...events, ...klines]);
  const priceAtDecision =
    candles.find((row) => row.openTime >= input.decisionTime.getTime())?.open ??
    candles[0]?.close ??
    input.fallbackPrice ??
    0;

  const sources = [
    snapshots.length > 0 ? "market_snapshot" : null,
    events.length > 0 ? "trade_event_log" : null,
    klines.length > 0 ? "klines" : null,
  ].filter(Boolean);

  const source =
    sources.length === 0
      ? input.fallbackPrice
        ? "decision_log"
        : "mixed"
      : sources.length === 1
        ? (sources[0] as PricePathResult["source"])
        : "mixed";

  const expectedPoints = Math.max(1, Math.floor(maxHorizonMs / (15 * 60_000)));
  const coveragePct = Math.min(100, Number(((candles.length / expectedPoints) * 100).toFixed(2)));

  return {
    candles,
    priceAtDecision,
    source,
    coveragePct,
  };
}

export function sliceCandlesUntil(candles: PriceCandle[], endMs: number) {
  return candles.filter((row) => row.openTime <= endMs);
}

export function computePathExtremes(candles: PriceCandle[], entryPrice: number) {
  if (candles.length === 0 || entryPrice <= 0) {
    return { highest: entryPrice, lowest: entryPrice, mfePct: 0, maePct: 0 };
  }
  const highest = candles.reduce((max, row) => Math.max(max, row.high), entryPrice);
  const lowest = candles.reduce((min, row) => Math.min(min, row.low), entryPrice);
  return {
    highest,
    lowest,
    mfePct: pctChange(entryPrice, highest),
    maePct: pctChange(entryPrice, lowest),
  };
}

export function priceAtTime(candles: PriceCandle[], targetMs: number, fallback: number) {
  let last = fallback;
  for (const row of candles) {
    if (row.openTime > targetMs) break;
    last = row.close;
  }
  return last;
}

export function computeAtr(candles: PriceCandle[], period = 14) {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const cur = candles[i]!;
    const prev = candles[i - 1]!;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    trs.push(tr);
  }
  const sample = trs.slice(-period);
  if (sample.length === 0) return null;
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}
