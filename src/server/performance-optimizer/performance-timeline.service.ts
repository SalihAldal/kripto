import { prisma } from "@/src/server/db/prisma";
import { persistTimeline } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";
import type { PerfOptTimelinePeriod } from "@prisma/client";

function periodBounds(period: PerfOptTimelinePeriod) {
  const end = new Date();
  const start = new Date(end);
  if (period === "DAILY") start.setDate(start.getDate() - 1);
  else if (period === "WEEKLY") start.setDate(start.getDate() - 7);
  else start.setMonth(start.getMonth() - 1);
  return { start, end };
}

export async function updatePerformanceTimeline(period: PerfOptTimelinePeriod = "DAILY") {
  const { start, end } = periodBounds(period);

  const [reviews, qualities, strategyRanks] = await Promise.all([
    prisma.perfOptPerformanceReview.findMany({ where: { reviewDate: { gte: start } }, orderBy: { reviewDate: "asc" } }),
    prisma.perfOptTradeQuality.findMany({ where: { scoredAt: { gte: start } }, orderBy: { scoredAt: "asc" } }),
    prisma.perfOptStrategyPerformanceHistory.findMany({ where: { recordedAt: { gte: start } }, orderBy: { recordedAt: "asc" } }),
  ]);

  const metrics = {
    reviewCount: reviews.length,
    avgWinRate: reviews.length > 0 ? reviews.reduce((s, r) => s + r.winRate, 0) / reviews.length : 0,
    avgProfitFactor: reviews.length > 0 ? reviews.reduce((s, r) => s + r.profitFactor, 0) / reviews.length : 0,
    capitalGrowth: reviews.reduce((s, r) => s + r.capitalGrowth, 0),
    avgTradeQuality: qualities.length > 0 ? qualities.reduce((s, q) => s + q.overallScore, 0) / qualities.length : 0,
  };

  const tradeEvolution = qualities.map((q) => ({ at: q.scoredAt.toISOString(), score: q.overallScore, symbol: q.symbol }));
  const strategyEvolution = strategyRanks.map((s) => ({ at: s.recordedAt.toISOString(), strategy: s.strategyType, winRate: s.winRate, rank: s.rank }));

  const timeline = await persistTimeline(period, start, end, metrics, { trades: tradeEvolution }, { strategies: strategyEvolution });
  emitPerfOptEvent(PERF_OPT_EVENT.TIMELINE_UPDATED, { timelineKey: timeline.timelineKey, period });
  return timeline;
}
