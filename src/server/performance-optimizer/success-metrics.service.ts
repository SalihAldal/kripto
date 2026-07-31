import { prisma } from "@/src/server/db/prisma";
import { persistSuccessMetrics, persistOptimizationHistory } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";

function trend(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export async function calculateSuccessMetrics() {
  const reviews = await prisma.perfOptPerformanceReview.findMany({ orderBy: { reviewDate: "desc" }, take: 60 });
  const qualities = await prisma.perfOptTradeQuality.findMany({ orderBy: { scoredAt: "desc" }, take: 100 });
  const missed = await prisma.perfOptMissedOpportunity.findMany({ orderBy: { detectedAt: "desc" }, take: 100 });

  const recent = reviews.slice(0, 7);
  const prior = reviews.slice(7, 14);

  const avgPf = (arr: typeof reviews) => arr.length > 0 ? arr.reduce((s, r) => s + r.profitFactor, 0) / arr.length : 0;
  const avgWr = (arr: typeof reviews) => arr.length > 0 ? arr.reduce((s, r) => s + r.winRate, 0) / arr.length : 0;
  const avgGrowth = (arr: typeof reviews) => arr.reduce((s, r) => s + r.capitalGrowth, 0);
  const avgDd = (arr: typeof reviews) => arr.length > 0 ? arr.reduce((s, r) => s + r.drawdown, 0) / arr.length : 0;
  const avgQ = qualities.length > 0 ? qualities.reduce((s, q) => s + q.overallScore, 0) / qualities.length : 0;
  const missedAvg = missed.length > 0 ? missed.reduce((s, m) => s + m.missedProfitPct, 0) / missed.length : 0;

  const capitalGrowthCurve = reviews.slice(0, 30).reverse().map((r, i) => ({
    day: i,
    growth: r.capitalGrowth,
    cumulative: reviews.slice(0, i + 1).reduce((s, x) => s + x.capitalGrowth, 0),
  }));

  const metrics = await persistSuccessMetrics({
    profitFactorTrend: Number(trend(avgPf(recent), avgPf(prior)).toFixed(2)),
    winRateTrend: Number(trend(avgWr(recent), avgWr(prior)).toFixed(2)),
    monthlyReturnTrend: Number(trend(avgGrowth(recent), avgGrowth(prior)).toFixed(2)),
    maxDrawdownTrend: Number(trend(avgDd(recent), avgDd(prior)).toFixed(2)),
    tradeQualityTrend: Number(avgQ.toFixed(2)),
    missedOpportunityTrend: Number((-missedAvg).toFixed(2)),
    avgHoldingTrend: 0,
    capitalGrowthCurve,
  });

  await persistOptimizationHistory({
    actionType: "SUCCESS_METRICS_CALCULATED",
    target: "PERFORMANCE_OPTIMIZER",
    summary: `PF trend ${metrics.profitFactorTrend}%, WR trend ${metrics.winRateTrend}%`,
    afterMetrics: { profitFactorTrend: metrics.profitFactorTrend, winRateTrend: metrics.winRateTrend },
  });

  emitPerfOptEvent(PERF_OPT_EVENT.SUCCESS_METRICS_CALCULATED, { metricsKey: metrics.metricsKey });
  return metrics;
}
