import { prisma } from "@/src/server/db/prisma";
import { persistLearningReport } from "@/src/server/learning-platform/learning-platform.repository";
import { emitLearningPlatformEvent, LEARNING_PLATFORM_EVENT } from "@/src/server/learning-platform/learning-platform.events";

export async function generateDailyLearningReport(date = new Date()) {
  const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const [trades, decisions, missed, falseSignals, coinProfiles] = await Promise.all([
    prisma.learningTrade.findMany({
      where: {
        OR: [
          { closedAt: { gte: dayStart, lt: dayEnd } },
          { closedAt: null, createdAt: { gte: dayStart, lt: dayEnd } },
        ],
      },
      take: 500,
    }),
    prisma.decisionLog.findMany({ where: { timestamp: { gte: dayStart, lt: dayEnd } }, take: 500 }),
    prisma.missedOpportunity.count({ where: { createdAt: { gte: dayStart, lt: dayEnd } } }),
    prisma.decisionEvaluation.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        verdict: { in: ["FALSE_BUY", "FALSE_SELL", "WRONG", "MISSED_WINNER"] },
      },
    }),
    prisma.coinProfile.findMany({ orderBy: { avgWinRate: "desc" }, take: 10 }),
  ]);

  const wins = trades.filter((t) => t.outcome === "WIN");
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  const coinPnl = new Map<string, number>();
  const hourPnl = new Map<number, number>();
  for (const trade of trades) {
    coinPnl.set(trade.symbol, (coinPnl.get(trade.symbol) ?? 0) + Number(trade.returnPercent ?? 0));
    const hour = (trade.openedAt ?? trade.createdAt).getUTCHours();
    hourPnl.set(hour, (hourPnl.get(hour) ?? 0) + Number(trade.returnPercent ?? 0));
  }

  const topCoins = [...coinPnl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([symbol, pnl]) => ({ symbol, pnl }));
  const worstCoins = [...coinPnl.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5).map(([symbol, pnl]) => ({ symbol, pnl }));
  const bestHours = [...hourPnl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([hour, pnl]) => ({ hour, pnl }));
  const worstHours = [...hourPnl.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([hour, pnl]) => ({ hour, pnl }));

  const bestDecisions = decisions
    .filter((d) => d.decision.includes("BUY"))
    .slice(0, 5)
    .map((d) => ({ decisionId: d.decisionId, symbol: d.symbol, confidence: d.confidence }));

  const worstDecisions = await prisma.decisionEvaluation.findMany({
    where: { createdAt: { gte: dayStart, lt: dayEnd }, verdict: { in: ["WRONG", "FALSE_BUY", "MISSED_WINNER"] } },
    take: 5,
    select: { decisionId: true, verdict: true, missedProfitPct: true },
  });

  const strengths = [
    winRate >= 50 ? `Win rate ${winRate.toFixed(1)}% on ${trades.length} trades` : null,
    topCoins[0] ? `Best coin ${topCoins[0].symbol} (+${topCoins[0].pnl.toFixed(2)}%)` : null,
  ].filter(Boolean);

  const weaknesses = [
    missed > 0 ? `${missed} missed opportunities` : null,
    falseSignals > 0 ? `${falseSignals} false signals` : null,
    winRate < 45 ? `Low win rate ${winRate.toFixed(1)}%` : null,
  ].filter(Boolean);

  const improvements = [
    missed > 5 ? "Review entry thresholds on high-momentum breakouts" : null,
    falseSignals > 3 ? "Tighten fake breakout filters in training data" : null,
    worstCoins[0] ? `Reduce exposure to ${worstCoins[0].symbol} until coin profile improves` : null,
  ].filter(Boolean);

  const summary = `Daily learning: ${trades.length} trades, WR ${winRate.toFixed(1)}%, missed ${missed}, false ${falseSignals}`;

  const report = await persistLearningReport({
    reportType: "DAILY",
    reportDate: dayStart,
    strengths,
    weaknesses,
    worstDecisions,
    bestDecisions,
    topCoins,
    worstCoins,
    bestHours,
    worstHours,
    improvements,
    summary,
    metadata: { decisions: decisions.length, coinProfiles: coinProfiles.length },
  });

  emitLearningPlatformEvent(LEARNING_PLATFORM_EVENT.REPORT_GENERATED, { reportId: report.id, reportType: "DAILY" });
  return report;
}
