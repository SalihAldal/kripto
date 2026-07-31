import { prisma } from "@/src/server/db/prisma";
import { persistCoinPerformance } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";

export async function rankCoinPerformance() {
  const closed = await prisma.position.findMany({
    where: { status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 500,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const bySymbol = new Map<string, { wins: number; total: number; profit: number; loss: number }>();
  for (const pos of closed) {
    const sym = pos.tradingPair?.symbol ?? "";
    if (!sym) continue;
    const b = bySymbol.get(sym) ?? { wins: 0, total: 0, profit: 0, loss: 0 };
    b.total += 1;
    if ((pos.realizedPnl ?? 0) > 0) { b.wins += 1; b.profit += pos.realizedPnl ?? 0; }
    else b.loss += Math.abs(pos.realizedPnl ?? 0);
    bySymbol.set(sym, b);
  }

  const ranked = [...bySymbol.entries()].map(([symbol, b]) => ({
    symbol,
    winRate: b.total > 0 ? (b.wins / b.total) * 100 : 0,
    profitFactor: b.loss > 0 ? b.profit / b.loss : b.profit > 0 ? 99 : 0,
    totalProfitPct: b.profit - b.loss,
    tradeCount: b.total,
  })).sort((a, b) => b.totalProfitPct - a.totalProfitPct);

  const records = [];
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i]!;
    records.push(await persistCoinPerformance({
      ...r,
      rank: i + 1,
      isWorst: i >= ranked.length - 5,
      category: null,
      narrative: null,
    }));
  }

  emitPerfOptEvent(PERF_OPT_EVENT.RANKING_UPDATED, { type: "coin", count: records.length });
  return { ranked: records.length, best: records.slice(0, 10), worst: records.filter((r) => r.isWorst) };
}
