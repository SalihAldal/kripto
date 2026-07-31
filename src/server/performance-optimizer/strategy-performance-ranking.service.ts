import { prisma } from "@/src/server/db/prisma";
import { persistStrategyPerformanceHistory } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";

export async function rankStrategyPerformance() {
  const selections = await prisma.adaptiveStrategySelection.findMany({
    orderBy: { selectedAt: "desc" },
    take: 500,
  }).catch(() => []);

  const byStrategy = new Map<string, { wins: number; total: number; profitSum: number; losses: number }>();
  for (const sel of selections) {
    const bucket = byStrategy.get(sel.primaryStrategy) ?? { wins: 0, total: 0, profitSum: 0, losses: 0 };
    bucket.total += 1;
    if (sel.validationPassed) bucket.wins += 1;
    bucket.profitSum += sel.expectedSuccess;
    byStrategy.set(sel.primaryStrategy, bucket);
  }

  const closed = await prisma.position.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 200,
    select: { realizedPnl: true },
  }).catch(() => []);

  const rankings = [...byStrategy.entries()].map(([strategyType, b]) => {
    const winRate = b.total > 0 ? (b.wins / b.total) * 100 : 0;
    const profitFactor = b.losses > 0 ? b.profitSum / b.losses : 1.5;
    return { strategyType, winRate, profitFactor, expectancy: b.total > 0 ? b.profitSum / b.total : 0, averageReturn: b.profitSum / Math.max(b.total, 1), maxDrawdown: 0, tradeCount: b.total };
  }).sort((a, b) => b.winRate * b.profitFactor - a.winRate * a.profitFactor);

  const records = [];
  for (let i = 0; i < rankings.length; i++) {
    const r = rankings[i]!;
    records.push(await persistStrategyPerformanceHistory({ ...r, rank: i + 1, metadata: { positionsSampled: closed.length } }));
  }

  emitPerfOptEvent(PERF_OPT_EVENT.RANKING_UPDATED, { type: "strategy", count: records.length });
  return { ranked: records.length, rankings: records };
}
