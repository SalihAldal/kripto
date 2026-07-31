import { prisma } from "@/src/server/db/prisma";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";

export async function updateCoinScoreboard(userId?: string) {
  const trades = await prisma.paperTrade.findMany({
    where: { userId, status: "CLOSED" },
    orderBy: { closedAt: "asc" },
    take: 5000,
  });

  const bySymbol = new Map<string, typeof trades>();
  for (const trade of trades) {
    const bucket = bySymbol.get(trade.symbol) ?? [];
    bucket.push(trade);
    bySymbol.set(trade.symbol, bucket);
  }

  const updated = [];
  for (const [symbol, symbolTrades] of bySymbol) {
    const returns = symbolTrades.map((t) => t.returnPct);
    const metrics = computePerformanceMetrics(returns);
    const holdSecs = symbolTrades.filter((t) => t.holdSec != null).map((t) => t.holdSec!);
    const avgSlippage = symbolTrades.reduce((s, t) => s + t.slippagePct, 0) / symbolTrades.length;
    const uid = userId ?? symbolTrades[0]!.userId;

    const row = await prisma.coinPerformance.upsert({
      where: { userId_symbol: { userId: uid, symbol } },
      create: {
        userId: uid,
        symbol,
        tradeCount: symbolTrades.length,
        winRate: metrics.winRate,
        avgReturn: metrics.avgReturnPct,
        avgHoldSec: holdSecs.length > 0 ? holdSecs.reduce((s, h) => s + h, 0) / holdSecs.length : 0,
        profitFactor: metrics.profitFactor,
        maxDrawdownPct: metrics.maxDrawdownPct,
        avgSlippage,
        periodStart: symbolTrades[0]?.openedAt,
        periodEnd: symbolTrades[symbolTrades.length - 1]?.closedAt ?? undefined,
        metadata: { metrics },
      },
      update: {
        tradeCount: symbolTrades.length,
        winRate: metrics.winRate,
        avgReturn: metrics.avgReturnPct,
        avgHoldSec: holdSecs.length > 0 ? holdSecs.reduce((s, h) => s + h, 0) / holdSecs.length : 0,
        profitFactor: metrics.profitFactor,
        maxDrawdownPct: metrics.maxDrawdownPct,
        avgSlippage,
        periodEnd: symbolTrades[symbolTrades.length - 1]?.closedAt ?? undefined,
        metadata: { metrics },
      },
    });
    updated.push(row);
  }

  updated.sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
  return { coins: updated.length, leaderboard: updated.slice(0, 25) };
}

export async function getCoinLeaderboard(userId?: string, limit = 25) {
  return prisma.coinPerformance.findMany({
    where: userId ? { userId } : {},
    orderBy: [{ profitFactor: "desc" }, { winRate: "desc" }],
    take: limit,
  });
}
