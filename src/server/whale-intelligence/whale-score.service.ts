import { prisma } from "@/src/server/db/prisma";
import { persistWhaleScore } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { emitWhaleEvent, WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.events";
import type { WhaleScoreResult } from "@/src/server/whale-intelligence/whale-intelligence.types";

export async function scoreWhaleActivity(walletId?: string) {
  const wallet = walletId
    ? await prisma.whaleWallet.findUnique({ where: { id: walletId }, include: { transactions: { orderBy: { detectedAt: "desc" }, take: 50 } } })
    : null;

  const transactions = wallet?.transactions ?? await prisma.whaleTransaction.findMany({ orderBy: { detectedAt: "desc" }, take: 50 });
  const inflow = transactions.filter((t) => t.direction === "INFLOW").reduce((s, t) => s + t.amountUsd, 0);
  const outflow = transactions.filter((t) => t.direction === "OUTFLOW").reduce((s, t) => s + t.amountUsd, 0);
  const total = inflow + outflow || 1;
  const avgConfidence = transactions.reduce((s, t) => s + t.confidence, 0) / Math.max(1, transactions.length);
  const avgReliability = transactions.reduce((s, t) => s + t.sourceReliability, 0) / Math.max(1, transactions.length);

  const replays = await prisma.whaleReplay.findMany({
    where: { transaction: { walletId: walletId ?? undefined } },
    take: 20,
    select: { maxMovePct: true, historicalAccuracy: true },
  });
  const historicalAccuracy = replays.length > 0
    ? replays.reduce((s, r) => s + (r.historicalAccuracy ?? Math.abs(r.maxMovePct ?? 0) * 10), 0) / replays.length
    : 50;

  const whaleActivityScore = Math.min(100, total / 10_000_000 + transactions.length * 2);
  const accumulationScore = Math.min(100, (inflow / total) * 100);
  const distributionScore = Math.min(100, (outflow / total) * 100);
  const expectedImpact = Math.min(100, whaleActivityScore * 0.4 + Math.abs(accumulationScore - distributionScore) * 0.3);
  const falseSignalProb = Math.max(5, 100 - avgConfidence * 0.6 - avgReliability * 0.4);

  const score: WhaleScoreResult = {
    whaleActivityScore: Number(whaleActivityScore.toFixed(1)),
    accumulationScore: Number(accumulationScore.toFixed(1)),
    distributionScore: Number(distributionScore.toFixed(1)),
    confidence: Number(avgConfidence.toFixed(1)),
    expectedImpact: Number(expectedImpact.toFixed(1)),
    sourceReliability: Number(avgReliability.toFixed(1)),
    historicalAccuracy: Number(Math.min(100, historicalAccuracy).toFixed(1)),
    falseSignalProb: Number(falseSignalProb.toFixed(1)),
  };

  const row = await persistWhaleScore({
    walletId: wallet?.id,
    asset: transactions[0]?.asset,
    exchange: transactions[0]?.exchange ?? undefined,
    score,
  });
  emitWhaleEvent(WHALE_EVENT.SCORE_COMPUTED, { walletId, whaleActivityScore: score.whaleActivityScore });
  return row;
}

export async function scoreRecentWhales(limit = 20) {
  const wallets = await prisma.whaleWallet.findMany({ orderBy: { lastActiveAt: "desc" }, take: limit, select: { id: true } });
  let scored = 0;
  for (const wallet of wallets) {
    await scoreWhaleActivity(wallet.id).catch(() => null);
    scored += 1;
  }
  return { scored };
}
