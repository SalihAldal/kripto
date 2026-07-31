import { prisma } from "@/src/server/db/prisma";
import { persistPerformanceReview } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";

export async function runDailyPerformanceReview(date = new Date()) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);

  const [closed, rejects] = await Promise.all([
    prisma.position.findMany({ where: { status: "CLOSED", closedAt: { gte: start, lt: end } }, select: { realizedPnl: true, entryPrice: true, quantity: true } }).catch(() => []),
    prisma.decisionLog.count({ where: { createdAt: { gte: start, lt: end }, decision: { in: ["REJECT", "REJECTED", "SKIP"] } } }).catch(() => 0),
  ]);

  const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0);
  const losses = closed.filter((p) => (p.realizedPnl ?? 0) < 0);
  const totalProfit = wins.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const totalLoss = Math.abs(losses.reduce((s, p) => s + (p.realizedPnl ?? 0), 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
  const expectancy = closed.length > 0 ? (totalProfit - totalLoss) / closed.length : 0;
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

  let peak = 0; let drawdown = 0; let equity = 0;
  for (const p of closed) {
    equity += p.realizedPnl ?? 0;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }

  const review = await persistPerformanceReview({
    reviewDate: start,
    tradeCount: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    averageProfit: wins.length > 0 ? totalProfit / wins.length : 0,
    averageLoss: losses.length > 0 ? totalLoss / losses.length : 0,
    profitFactor: Number(profitFactor.toFixed(2)),
    expectancy: Number(expectancy.toFixed(4)),
    drawdown: Number(drawdown.toFixed(4)),
    winRate: Number(winRate.toFixed(1)),
    capitalGrowth: Number((totalProfit - totalLoss).toFixed(4)),
    rejectedTrades: rejects,
  });

  emitPerfOptEvent(PERF_OPT_EVENT.DAILY_REVIEW_COMPLETED, { reviewKey: review.reviewKey });
  return review;
}
