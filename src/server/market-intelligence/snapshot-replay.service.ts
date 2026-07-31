import type { SnapshotInterval } from "@prisma/client";
import {
  findSnapshotNearTime,
  getLatestSnapshot,
  getSnapshotTimeline,
  upsertSnapshotReplay,
} from "@/src/server/market-intelligence/market-intelligence.repository";

export async function replayMarketState(input: {
  symbol: string;
  replayAt: Date;
  interval?: SnapshotInterval;
}) {
  const interval = input.interval ?? "M1";
  const cached = await findSnapshotNearTime(input.symbol, input.replayAt, interval);
  if (!cached) {
    return { found: false as const, symbol: input.symbol.toUpperCase(), replayAt: input.replayAt.toISOString() };
  }

  const payload = {
    symbol: cached.symbol,
    interval: cached.interval,
    snapshotAt: cached.snapshotAt.toISOString(),
    ohlc: { open: cached.open, high: cached.high, low: cached.low, close: cached.close },
    volume: { base: cached.volumeBase, quote: cached.volumeQuote, tradeCount: cached.tradeCount },
    vwap: cached.vwap,
    atr: cached.atr,
    trueRange: cached.trueRange,
    spread: cached.spread,
    bid: cached.bidPrice,
    ask: cached.askPrice,
    orderBookImbalance: cached.orderBookImbalance,
    liquidityScore: cached.liquidityScore,
    fundingRate: cached.fundingRate,
    openInterest: cached.openInterest,
    regime: cached.regime,
    healthScore: cached.healthScore,
    trend: cached.trend,
    momentum: cached.momentum,
    health: cached.health,
    liquidity: cached.liquidity,
    volumeIntel: cached.volumeIntel,
    correlations: {
      btc: cached.correlationBtc,
      eth: cached.correlationEth,
      relativeStrength: cached.relativeStrength,
    },
    volatility: {
      realized: cached.realizedVolatility,
      implied: cached.impliedVolatility,
    },
    whale: {
      activity: cached.whaleActivity,
      buyVolume: cached.whaleBuyVolume,
      sellVolume: cached.whaleSellVolume,
    },
    flow: {
      netFlow: cached.netFlow,
      volumeDelta: cached.volumeDelta,
      cvd: cached.cvd,
      aggressiveBuyPct: cached.aggressiveBuyPct,
      aggressiveSellPct: cached.aggressiveSellPct,
    },
  };

  await upsertSnapshotReplay({
    symbol: input.symbol,
    replayAt: input.replayAt,
    interval,
    snapshotId: cached.id,
    payload,
  });

  return { found: true as const, snapshotId: cached.id, payload };
}

export async function parseReplayQuery(input: { symbol: string; date: string; time: string }) {
  const replayAt = new Date(`${input.date}T${input.time}:00.000Z`);
  if (Number.isNaN(replayAt.getTime())) {
    throw new Error("Invalid replay datetime");
  }
  return replayMarketState({ symbol: input.symbol, replayAt });
}

export { getLatestSnapshot, getSnapshotTimeline };
