import { prisma } from "@/src/server/db/prisma";
import { persistBusinessKpi } from "@/src/server/aoc/aoc.repository";

export async function collectBusinessKpis() {
  const closed = await prisma.position.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 200,
    select: { realizedPnl: true, openedAt: true, closedAt: true },
  }).catch(() => []);

  const wins = closed.filter((p) => (p.realizedPnl ?? 0) > 0);
  const losses = closed.filter((p) => (p.realizedPnl ?? 0) < 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const totalProfit = wins.reduce((s, p) => s + (p.realizedPnl ?? 0), 0);
  const totalLoss = Math.abs(losses.reduce((s, p) => s + (p.realizedPnl ?? 0), 0));
  const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0;
  const averageProfit = wins.length > 0 ? totalProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? totalLoss / losses.length : 0;
  const expectancy = closed.length > 0 ? (totalProfit - totalLoss) / closed.length : 0;

  const decisions = await prisma.decisionLog.count().catch(() => 0);
  const correctDecisions = await prisma.decisionLog.count({ where: { decision: { in: ["BUY", "SELL", "EXECUTE"] } } }).catch(() => 0);
  const decisionAccuracy = decisions > 0 ? (correctDecisions / decisions) * 100 : 50;

  return persistBusinessKpi({
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    expectancy: Number(expectancy.toFixed(4)),
    averageProfit: Number(averageProfit.toFixed(4)),
    averageLoss: Number(averageLoss.toFixed(4)),
    tradeFrequency: closed.length,
    decisionAccuracy: Number(decisionAccuracy.toFixed(1)),
    portfolioGrowth: Number((totalProfit - totalLoss).toFixed(4)),
  });
}
