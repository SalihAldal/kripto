import { prisma } from "@/src/server/db/prisma";

export async function validatePaperRisk(userId?: string) {
  const trades = await prisma.paperTrade.findMany({
    where: { userId, status: "CLOSED" },
    orderBy: { closedAt: "asc" },
    take: 5000,
  });

  if (trades.length === 0) {
    return { userId, sampleSize: 0, validation: null };
  }

  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let currentWin = 0;
  let currentLoss = 0;

  for (const trade of trades) {
    if (trade.returnPct > 0) {
      currentWin++;
      currentLoss = 0;
      if (currentWin > maxWinStreak) maxWinStreak = currentWin;
    } else {
      currentLoss++;
      currentWin = 0;
      if (currentLoss > maxLossStreak) maxLossStreak = currentLoss;
    }
  }

  const portfolio = await prisma.paperPortfolio.findUnique({ where: { userId: userId ?? trades[0]!.userId } });
  const totalNotional = trades.reduce((s, t) => s + t.quantity * t.entryPrice, 0);
  const avgNotional = totalNotional / trades.length;
  const capitalUtilization = portfolio && portfolio.balance > 0 ? (portfolio.lockedBalance / portfolio.balance) * 100 : 0;
  const avgRiskPerTrade = trades.reduce((s, t) => s + Math.abs(t.returnPct), 0) / trades.length;
  const holdSecs = trades.filter((t) => t.holdSec != null).map((t) => t.holdSec!);
  const avgPositionDuration = holdSecs.length > 0 ? holdSecs.reduce((s, h) => s + h, 0) / holdSecs.length : 0;

  return {
    userId: userId ?? trades[0]!.userId,
    sampleSize: trades.length,
    validation: {
      largestWinningStreak: maxWinStreak,
      largestLosingStreak: maxLossStreak,
      capitalUtilizationPct: Number(capitalUtilization.toFixed(2)),
      avgRiskPerTradePct: Number(avgRiskPerTrade.toFixed(3)),
      avgPositionDurationSec: Number(avgPositionDuration.toFixed(0)),
      avgNotional: Number(avgNotional.toFixed(2)),
      maxSingleLossPct: Math.min(...trades.map((t) => t.returnPct)),
      maxSingleWinPct: Math.max(...trades.map((t) => t.returnPct)),
    },
  };
}
