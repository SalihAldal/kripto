import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";

export async function calculatePaperAccuracy(input?: { userId?: string; limit?: number }) {
  const executions = await prisma.paperExecution.findMany({
    where: input?.userId
      ? { paperTrade: { userId: input.userId } }
      : {},
    orderBy: { executedAt: "desc" },
    take: input?.limit ?? 100,
    include: { paperTrade: { select: { symbol: true, userId: true } } },
  });

  if (executions.length === 0) {
    return { sampleSize: 0, avgFillAccuracy: 0, avgPriceDifference: 0, avgLatencyMs: 0 };
  }

  const avgFillAccuracy =
    executions.reduce((s, e) => s + (e.fillAccuracyPct ?? 0), 0) / executions.length;
  const avgPriceDifference =
    executions.reduce((s, e) => s + Math.abs(e.priceDifference ?? 0), 0) / executions.length;
  const avgLatencyMs = executions.reduce((s, e) => s + (e.latencyMs ?? 0), 0) / executions.length;

  return {
    sampleSize: executions.length,
    avgFillAccuracy: Number(avgFillAccuracy.toFixed(3)),
    avgPriceDifference: Number(avgPriceDifference.toFixed(6)),
    avgLatencyMs: Number(avgLatencyMs.toFixed(1)),
    executions: executions.slice(0, 20).map((e) => ({
      symbol: e.paperTrade.symbol,
      side: e.side,
      fillAccuracyPct: e.fillAccuracyPct,
      priceDifference: e.priceDifference,
      expectedFillPrice: e.expectedFillPrice,
      avgFillPrice: e.avgFillPrice,
      latencyMs: e.latencyMs,
    })),
  };
}

export async function calculatePaperMetrics(userId?: string) {
  const trades = await prisma.paperTrade.findMany({
    where: { userId, status: "CLOSED" },
    orderBy: { closedAt: "asc" },
    take: 5000,
  });

  if (trades.length === 0) return { userId, tradeCount: 0 };

  const returns = trades.map((t) => t.returnPct);
  const metrics = computePerformanceMetrics(returns);
  const holdSecs = trades.filter((t) => t.holdSec != null).map((t) => t.holdSec!);
  const avgHoldSec = holdSecs.length > 0 ? holdSecs.reduce((s, h) => s + h, 0) / holdSecs.length : 0;

  for (const trade of trades.slice(-50)) {
    await prisma.paperMetrics.upsert({
      where: { paperTradeId: trade.id },
      create: {
        paperTradeId: trade.id,
        userId: trade.userId,
        profitFactor: metrics.profitFactor,
        expectancy: metrics.expectancy,
        winRate: metrics.winRate,
        maxDrawdownPct: metrics.maxDrawdownPct,
        avgHoldSec,
        metrics: metrics as unknown as Prisma.InputJsonValue,
      },
      update: {
        profitFactor: metrics.profitFactor,
        expectancy: metrics.expectancy,
        winRate: metrics.winRate,
        maxDrawdownPct: metrics.maxDrawdownPct,
        avgHoldSec,
        metrics: metrics as unknown as Prisma.InputJsonValue,
        computedAt: new Date(),
      },
    });
  }

  return {
    userId,
    tradeCount: trades.length,
    metrics,
    avgHoldSec,
  };
}
