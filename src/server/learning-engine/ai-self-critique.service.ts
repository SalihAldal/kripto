import { prisma } from "@/src/server/db/prisma";
import { persistDailyAIReport } from "@/src/server/learning-engine/learning-engine.repository";

export async function generateDailyAIReport(date = new Date()) {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const [decisions, trades, rejects, missed, falsePos] = await Promise.all([
    prisma.decisionLog.count({ where: { timestamp: { gte: dayStart, lt: dayEnd } } }),
    prisma.learningTrade.findMany({ where: { closedAt: { gte: dayStart, lt: dayEnd } }, take: 200 }),
    prisma.decisionEvaluation.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        verdict: { in: ["CORRECT", "PARTIALLY_CORRECT"] },
      },
    }),
    prisma.missedOpportunity.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.decisionEvaluation.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        verdict: { in: ["FALSE_BUY", "FALSE_SELL", "WRONG", "MISSED_WINNER", "MISSED_BREAKOUT", "MISSED_PUMP"] },
      },
    }),
  ]);

  const wins = trades.filter((row) => row.outcome === "WIN").length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const avgRoe = trades.length > 0 ? trades.reduce((sum, row) => sum + Number(row.returnPercent ?? 0), 0) / trades.length : 0;

  const content = {
    reportDate: dayStart.toISOString(),
    whatDidWell: [
      winRate >= 50 ? `Win rate ${winRate.toFixed(1)}% on ${trades.length} trades` : null,
      rejects > missed ? `Reject discipline avoided ${rejects} bad setups` : null,
    ].filter(Boolean),
    mistakes: [
      falsePos > 0 ? `${falsePos} false signals detected` : null,
      missed > 0 ? `Missed ${missed} opportunities` : null,
      winRate < 45 ? `Low win rate ${winRate.toFixed(1)}%` : null,
    ].filter(Boolean),
    missedOpportunities: missed,
    wrongFilters: await topWrongFilters(dayStart, dayEnd),
    improvements: [
      missed > 5 ? "Review momentum threshold on high-volume breakouts" : null,
      falsePos > 3 ? "Tighten fake pump detection" : null,
    ].filter(Boolean),
    misunderstoodMarkets: await misunderstoodRegimes(dayStart, dayEnd),
    stats: { decisions, trades: trades.length, winRate, avgRoe, rejects, missed, falsePos },
  };

  const summary = `Daily critique: ${trades.length} trades, WR ${winRate.toFixed(1)}%, missed ${missed}, false+ ${falsePos}`;
  await persistDailyAIReport({ reportDate: dayStart, content, summary });
  return content;
}

async function topWrongFilters(since: Date, until: Date) {
  const rows = await prisma.decisionAttribution.findMany({
    where: { createdAt: { gte: since, lt: until } },
    orderBy: { contributionWeight: "asc" },
    take: 10,
  });
  return rows.map((row) => row.factorName).filter(Boolean);
}

async function misunderstoodRegimes(since: Date, until: Date) {
  const rows = await prisma.learningTrade.findMany({
    where: { closedAt: { gte: since, lt: until }, outcome: "LOSS" },
    take: 50,
    select: { metadata: true },
  });
  const regimes = rows.map((row) => String((row.metadata as Record<string, unknown> | null)?.marketRegime ?? "UNKNOWN"));
  const counts = new Map<string, number>();
  for (const regime of regimes) counts.set(regime, (counts.get(regime) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([regime, count]) => ({ regime, losses: count }));
}
