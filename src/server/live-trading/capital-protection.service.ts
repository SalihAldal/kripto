import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { ensureCapitalProtection, triggerCircuitBreaker } from "@/src/server/live-trading/live-trading.repository";
import type { CapitalProtectionCheck } from "@/src/server/live-trading/live-trading.types";

export async function evaluateCapitalProtection(input: {
  userId: string;
  symbol: string;
  side: string;
  notional?: number;
}): Promise<CapitalProtectionCheck> {
  const state = await ensureCapitalProtection(input.userId);
  const blockers: string[] = [];

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const todayTrades = await prisma.liveTrade.findMany({
    where: { userId: input.userId, openedAt: { gte: todayStart } },
  });

  const dailyPnl = todayTrades.reduce((s, t) => s + t.realizedPnl, 0);
  const dailyTradeCount = todayTrades.length;
  const openPositions = await prisma.position.count({ where: { userId: input.userId, status: "OPEN" } });

  const recentClosed = await prisma.liveTrade.findMany({
    where: { userId: input.userId, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: state.maxConsecutiveLosses + 1,
  });

  let consecutiveLosses = 0;
  for (const trade of recentClosed) {
    if (trade.returnPct < 0) consecutiveLosses++;
    else break;
  }

  const totalCapital = env.RISK_TOTAL_CAPITAL_TRY;
  const dailyLossPct = totalCapital > 0 ? Math.abs(Math.min(0, dailyPnl) / totalCapital) * 100 : 0;
  const notional = input.notional ?? 0;
  const positionSizePct = totalCapital > 0 ? (notional / totalCapital) * 100 : 0;

  if (dailyLossPct >= state.dailyLossLimitPct) {
    blockers.push(`Daily loss limit exceeded: ${dailyLossPct.toFixed(2)}% >= ${state.dailyLossLimitPct}%`);
  }
  if (dailyTradeCount >= state.maxDailyTrades && input.side === "BUY") {
    blockers.push(`Max daily trades reached: ${dailyTradeCount}`);
  }
  if (openPositions >= state.maxOpenPositions && input.side === "BUY") {
    blockers.push(`Max open positions reached: ${openPositions}`);
  }
  if (consecutiveLosses >= state.maxConsecutiveLosses && input.side === "BUY") {
    blockers.push(`Max consecutive losses: ${consecutiveLosses}`);
  }
  if (positionSizePct > state.maxPositionSizePct && input.side === "BUY") {
    blockers.push(`Position size ${positionSizePct.toFixed(1)}% exceeds max ${state.maxPositionSizePct}%`);
  }

  const blocked = blockers.length > 0;
  await prisma.capitalProtection.update({
    where: { userId: input.userId },
    data: {
      dailyPnl,
      dailyTradeCount,
      consecutiveLosses,
      openPositionCount: openPositions,
      totalExposure: notional,
      blocked,
      blockReason: blocked ? blockers.join("; ") : null,
    },
  });

  return {
    passed: !blocked,
    blockers,
    state: { dailyPnl, dailyTradeCount, consecutiveLosses, openPositions, dailyLossPct, positionSizePct },
  };
}

export async function recordLiveTradeOutcome(input: {
  userId: string;
  returnPct: number;
  realizedPnl: number;
}) {
  const state = await ensureCapitalProtection(input.userId);
  const consecutiveLosses = input.returnPct < 0 ? state.consecutiveLosses + 1 : 0;
  await prisma.capitalProtection.update({
    where: { userId: input.userId },
    data: {
      dailyPnl: state.dailyPnl + input.realizedPnl,
      consecutiveLosses,
    },
  });
}
