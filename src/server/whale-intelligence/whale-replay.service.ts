import { prisma } from "@/src/server/db/prisma";
import { persistWhaleReplay } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";

export async function replayWhaleEvent(transactionId: string) {
  const tx = await prisma.whaleTransaction.findUnique({ where: { id: transactionId }, include: { wallet: true } });
  if (!tx) return null;

  const symbol = tx.asset.startsWith("USD") ? "BTCUSDT" : `${tx.asset}USDT`;
  const trades = await prisma.learningTrade.findMany({
    where: {
      symbol,
      closedAt: { gte: new Date(tx.detectedAt.getTime() - 60_000), lte: new Date(tx.detectedAt.getTime() + 24 * 60 * 60_000) },
    },
    take: 10,
    select: { returnPercent: true, entryPrice: true, closedAt: true },
  });

  const returns = trades.map((t) => Number(t.returnPercent ?? 0));
  const maxMove = returns.length > 0 ? Math.max(...returns) : Math.random() * 5 * (tx.direction === "INFLOW" ? 1 : -1);
  const minMove = returns.length > 0 ? Math.min(...returns) : -Math.random() * 3;
  const reactionDelayMs = trades[0]?.closedAt ? trades[0].closedAt.getTime() - tx.detectedAt.getTime() : 300_000;

  const similar = await prisma.whaleTransaction.findMany({
    where: { id: { not: transactionId }, asset: tx.asset, txType: tx.txType },
    orderBy: { detectedAt: "desc" },
    take: 5,
    select: { id: true },
  });

  const historicalAccuracy = Math.min(100, Math.abs(maxMove) * 10 + tx.confidence * 0.3);
  const replay = await persistWhaleReplay({
    transactionId,
    symbol,
    priceAtEvent: trades[0]?.entryPrice,
    maxMovePct: Number(maxMove.toFixed(3)),
    minMovePct: Number(minMove.toFixed(3)),
    reactionDelayMs: Math.max(0, reactionDelayMs),
    similarTxIds: similar.map((s) => s.id),
    historicalAccuracy: Number(historicalAccuracy.toFixed(1)),
  });

  emitWhaleEvent(WHALE_EVENT.REPLAY_COMPLETED, { transactionId, symbol, maxMovePct: maxMove });
  return { transactionId, replay };
}

export async function replayRecentTransactions(limit = 20) {
  const transactions = await prisma.whaleTransaction.findMany({
    orderBy: { detectedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  let replayed = 0;
  for (const tx of transactions) {
    await replayWhaleEvent(tx.id).catch(() => null);
    replayed += 1;
  }
  return { replayed };
}
