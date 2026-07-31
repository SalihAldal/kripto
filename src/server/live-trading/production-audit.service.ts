import type { ProductionReportCadence } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { dispatchLiveAlert } from "@/src/server/live-trading/alert-dispatcher.service";

export async function generateProductionReport(input: {
  userId: string;
  cadence: ProductionReportCadence;
  reportDate?: Date;
}) {
  const reportDate = input.reportDate ?? new Date();
  const dayStart = new Date(Date.UTC(reportDate.getUTCFullYear(), reportDate.getUTCMonth(), reportDate.getUTCDate()));

  let periodStart: Date;
  if (input.cadence === "WEEKLY") {
    periodStart = new Date(dayStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (input.cadence === "MONTHLY") {
    periodStart = new Date(dayStart.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    periodStart = dayStart;
  }

  const periodEnd =
    input.cadence === "DAILY"
      ? new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
      : new Date();

  const trades = await prisma.liveTrade.findMany({
    where: {
      userId: input.userId,
      status: "CLOSED",
      closedAt: { gte: periodStart, lt: periodEnd },
    },
  });

  const returns = trades.map((t) => t.returnPct);
  const metrics = computePerformanceMetrics(returns);
  const dailyPnl = trades.reduce((s, t) => s + t.realizedPnl, 0);

  const byCoin = aggregateByField(trades, "symbol");
  const byStrategy = aggregateByField(trades, "strategy");

  const report = await prisma.productionReport.upsert({
    where: {
      userId_cadence_reportDate: { userId: input.userId, cadence: input.cadence, reportDate: dayStart },
    },
    create: {
      userId: input.userId,
      cadence: input.cadence,
      reportDate: dayStart,
      tradeCount: trades.length,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      expectancy: metrics.expectancy,
      dailyPnl,
      maxDrawdown: metrics.maxDrawdownPct,
      summary: `${input.cadence}: ${trades.length} trades, WR ${metrics.winRate.toFixed(1)}%, PF ${metrics.profitFactor.toFixed(2)}`,
      content: { metrics, byCoin, byStrategy, capitalCurve: buildCapitalCurve(trades) },
    },
    update: {
      tradeCount: trades.length,
      winRate: metrics.winRate,
      profitFactor: metrics.profitFactor,
      expectancy: metrics.expectancy,
      dailyPnl,
      maxDrawdown: metrics.maxDrawdownPct,
      summary: `${input.cadence}: ${trades.length} trades, WR ${metrics.winRate.toFixed(1)}%`,
      content: { metrics, byCoin, byStrategy, capitalCurve: buildCapitalCurve(trades) },
    },
  });

  if (input.cadence === "DAILY") {
    await dispatchLiveAlert({
      userId: input.userId,
      eventType: "DAILY_REPORT",
      severity: "INFO",
      title: "Daily Production Report",
      message: report.summary ?? "",
    });
  }

  return report;
}

function aggregateByField(trades: Array<{ symbol: string; strategy: string | null; returnPct: number }>, field: "symbol" | "strategy") {
  const map = new Map<string, number[]>();
  for (const t of trades) {
    const key = String(t[field] ?? "UNKNOWN");
    const bucket = map.get(key) ?? [];
    bucket.push(t.returnPct);
    map.set(key, bucket);
  }
  return [...map.entries()].map(([key, returns]) => ({
    key,
    tradeCount: returns.length,
    metrics: computePerformanceMetrics(returns),
  }));
}

function buildCapitalCurve(trades: Array<{ closedAt: Date | null; realizedPnl: number }>) {
  let equity = 0;
  return trades
    .filter((t) => t.closedAt)
    .sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime())
    .map((t) => {
      equity += t.realizedPnl;
      return { date: t.closedAt!.toISOString(), equity };
    });
}

export async function generateAllProductionReports(cadence: ProductionReportCadence = "DAILY") {
  const userIds = await prisma.liveTrade.findMany({ distinct: ["userId"], select: { userId: true }, take: 50 });
  const reports = [];
  for (const { userId } of userIds) {
    reports.push(await generateProductionReport({ userId, cadence }));
  }
  return { generated: reports.length, reports };
}
