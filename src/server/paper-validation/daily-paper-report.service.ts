import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";

export async function generateDailyPaperReport(input?: { userId?: string; date?: Date }) {
  const reportDate = input?.date ?? new Date();
  const dayStart = new Date(Date.UTC(reportDate.getUTCFullYear(), reportDate.getUTCMonth(), reportDate.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const userIds = input?.userId
    ? [input.userId]
    : (
        await prisma.paperTrade.findMany({
          distinct: ["userId"],
          select: { userId: true },
          where: { closedAt: { gte: dayStart, lt: dayEnd } },
        })
      ).map((r) => r.userId);

  const reports = [];
  for (const userId of userIds) {
    const trades = await prisma.paperTrade.findMany({
      where: { userId, status: "CLOSED", closedAt: { gte: dayStart, lt: dayEnd } },
    });

    if (trades.length === 0) continue;

    const returns = trades.map((t) => t.returnPct);
    const metrics = computePerformanceMetrics(returns);
    const wins = trades.filter((t) => t.returnPct > 0);
    const losses = trades.filter((t) => t.returnPct <= 0);
    const holdSecs = trades.filter((t) => t.holdSec != null).map((t) => t.holdSec!);

    const byCoin = aggregateByField(trades, "symbol");
    const byStrategy = aggregateByField(trades, "strategy");
    const byRegime = aggregateByField(trades, "marketRegime");

    const bestCoin = pickBest(byCoin);
    const worstCoin = pickWorst(byCoin);
    const bestStrategy = pickBest(byStrategy);
    const worstStrategy = pickWorst(byStrategy);
    const bestRegime = pickBest(byRegime);
    const worstRegime = pickWorst(byRegime);

    const report = await prisma.dailyPaperReport.upsert({
      where: { userId_reportDate: { userId, reportDate: dayStart } },
      create: {
        userId,
        reportDate: dayStart,
        tradeCount: trades.length,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        expectancy: metrics.expectancy,
        maxDrawdownPct: metrics.maxDrawdownPct,
        avgHoldSec: holdSecs.length > 0 ? holdSecs.reduce((s, h) => s + h, 0) / holdSecs.length : 0,
        avgProfit: wins.length > 0 ? wins.reduce((s, t) => s + t.returnPct, 0) / wins.length : 0,
        avgLoss: losses.length > 0 ? losses.reduce((s, t) => s + t.returnPct, 0) / losses.length : 0,
        totalFees: trades.reduce((s, t) => s + t.fees, 0),
        totalSlippage: trades.reduce((s, t) => s + t.slippagePct, 0),
        bestCoin,
        worstCoin,
        bestStrategy,
        worstStrategy,
        bestRegime,
        worstRegime,
        summary: `${trades.length} trades, WR ${metrics.winRate.toFixed(1)}%, PF ${metrics.profitFactor.toFixed(2)}`,
        content: { byCoin, byStrategy, byRegime, metrics } as Prisma.InputJsonValue,
      },
      update: {
        tradeCount: trades.length,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        expectancy: metrics.expectancy,
        maxDrawdownPct: metrics.maxDrawdownPct,
        summary: `${trades.length} trades, WR ${metrics.winRate.toFixed(1)}%, PF ${metrics.profitFactor.toFixed(2)}`,
        content: { byCoin, byStrategy, byRegime, metrics } as Prisma.InputJsonValue,
      },
    });
    reports.push(report);
  }

  return { reportDate: dayStart.toISOString(), reports: reports.length, items: reports };
}

function aggregateByField(
  trades: Array<{ symbol: string; strategy: string | null; marketRegime: string | null; returnPct: number }>,
  field: "symbol" | "strategy" | "marketRegime",
) {
  const map = new Map<string, number[]>();
  for (const trade of trades) {
    const key = String(trade[field] ?? "UNKNOWN");
    const bucket = map.get(key) ?? [];
    bucket.push(trade.returnPct);
    map.set(key, bucket);
  }
  return [...map.entries()].map(([key, returns]) => ({
    key,
    tradeCount: returns.length,
    avgReturn: returns.reduce((s, r) => s + r, 0) / returns.length,
    metrics: computePerformanceMetrics(returns),
  }));
}

function pickBest(entries: Array<{ key: string; avgReturn: number }>) {
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b.avgReturn - a.avgReturn)[0]?.key ?? null;
}

function pickWorst(entries: Array<{ key: string; avgReturn: number }>) {
  if (entries.length === 0) return null;
  return entries.sort((a, b) => a.avgReturn - b.avgReturn)[0]?.key ?? null;
}
