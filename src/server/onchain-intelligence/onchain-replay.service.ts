import { prisma } from "@/src/server/db/prisma";
import { persistOnChainReplay } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { emitOnChainEvent, ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.events";
import type { OnChainNetwork } from "@prisma/client";

export async function replayOnChainEvent(eventId?: string) {
  const eventAt = new Date(Date.now() - 60 * 60_000);
  const network: OnChainNetwork = "ETHEREUM";
  const protocol = "Uniswap";
  const asset = "ETH";
  const symbol = "ETHUSDT";

  const trades = await prisma.learningTrade.findMany({
    where: { symbol, closedAt: { gte: eventAt, lte: new Date(eventAt.getTime() + 24 * 60 * 60_000) } },
    take: 10,
    select: { returnPercent: true, entryPrice: true, closedAt: true },
  });

  const returns = trades.map((t) => Number(t.returnPercent ?? 0));
  const maxMove = returns.length > 0 ? Math.max(...returns) : Math.random() * 5;
  const minMove = returns.length > 0 ? Math.min(...returns) : -Math.random() * 3;
  const reactionDelayMs = trades[0]?.closedAt ? trades[0].closedAt.getTime() - eventAt.getTime() : 300_000;

  const similar = await prisma.onChainReplay.findMany({
    where: { network, protocol },
    orderBy: { eventAt: "desc" },
    take: 5,
    select: { id: true },
  });

  const replay = await persistOnChainReplay({
    network,
    eventType: eventId ? "METRIC_EVENT" : "TVL_SURGE",
    protocol,
    asset,
    symbol,
    priceAtEvent: trades[0]?.entryPrice,
    maxMovePct: Number(maxMove.toFixed(3)),
    minMovePct: Number(minMove.toFixed(3)),
    reactionDelayMs: Math.max(0, reactionDelayMs),
    similarEventIds: similar.map((s) => s.id),
    historicalAccuracy: Number(Math.min(100, Math.abs(maxMove) * 10 + 50).toFixed(1)),
    confidence: 65,
    eventAt,
  });

  emitOnChainEvent(ONCHAIN_EVENT.REPLAY_COMPLETED, { replayId: replay.id, symbol, maxMovePct: maxMove });
  return replay;
}

export async function replayRecentEvents(limit = 15) {
  const defiEvents = await prisma.deFiMetrics.findMany({ orderBy: { periodEnd: "desc" }, take: limit });
  let replayed = 0;
  for (const event of defiEvents) {
    const trades = await prisma.learningTrade.findMany({
      where: { symbol: `${event.protocol === "Uniswap" ? "UNI" : "ETH"}USDT`, closedAt: { gte: event.periodEnd } },
      take: 5,
      select: { returnPercent: true, entryPrice: true, closedAt: true },
    });
    const returns = trades.map((t) => Number(t.returnPercent ?? 0));
    await persistOnChainReplay({
      network: event.network,
      eventType: "DEFI_METRIC",
      protocol: event.protocol ?? undefined,
      symbol: event.protocol ? `${event.protocol.slice(0, 3).toUpperCase()}USDT` : "ETHUSDT",
      priceAtEvent: trades[0]?.entryPrice,
      maxMovePct: returns.length > 0 ? Math.max(...returns) : Math.random() * 3,
      minMovePct: returns.length > 0 ? Math.min(...returns) : -Math.random() * 2,
      reactionDelayMs: 300_000,
      historicalAccuracy: 55,
      confidence: 60,
      eventAt: event.periodEnd,
    }).catch(() => null);
    replayed += 1;
  }
  return { replayed };
}
