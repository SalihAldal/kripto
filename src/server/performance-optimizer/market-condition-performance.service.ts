import { prisma } from "@/src/server/db/prisma";

export async function analyzeMarketConditionPerformance() {
  const regimes = await prisma.adaptiveMarketRegime.findMany({ orderBy: { detectedAt: "desc" }, take: 200 }).catch(() => []);
  const closed = await prisma.position.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 200,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const byRegime = new Map<string, { wins: number; total: number; profit: number }>();
  for (const pos of closed) {
    const sym = pos.tradingPair?.symbol ?? "";
    const regime = regimes.find((r) => r.symbol === sym);
    const label = regime?.regimeLabel ?? "UNKNOWN";
    const b = byRegime.get(label) ?? { wins: 0, total: 0, profit: 0 };
    b.total += 1;
    if ((pos.realizedPnl ?? 0) > 0) b.wins += 1;
    b.profit += pos.realizedPnl ?? 0;
    byRegime.set(label, b);
  }

  return {
    conditions: [...byRegime.entries()].map(([regime, b]) => ({
      regime,
      winRate: b.total > 0 ? (b.wins / b.total) * 100 : 0,
      totalProfit: b.profit,
      tradeCount: b.total,
      performance: b.profit > 0 ? "BEST" : b.profit < 0 ? "WORST" : "NEUTRAL",
    })).sort((a, b) => b.totalProfit - a.totalProfit),
  };
}
