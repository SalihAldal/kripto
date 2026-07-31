import { prisma } from "@/src/server/db/prisma";
import { buildPricePath } from "@/src/server/replay/price-path.service";
import { persistEntryOptimization } from "@/src/server/performance-optimizer/performance-optimizer.repository";

export async function analyzeLateEntries(limit = 20) {
  const positions = await prisma.position.findMany({
    where: { status: "CLOSED", side: "LONG" },
    orderBy: { closedAt: "desc" },
    take: limit,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const results = [];
  for (const pos of positions) {
    const symbol = pos.tradingPair?.symbol ?? "";
    if (!symbol || !pos.closedAt) continue;

    const path = await buildPricePath({ symbol, decisionTime: pos.openedAt, fallbackPrice: pos.entryPrice }).catch(() => null);
    if (!path) continue;

    const window = path.candles.filter((c) => c.openTime <= pos.openedAt.getTime() + 3600_000);
    const earlier = window.reduce((min, c) => (c.low < min ? c.low : min), pos.entryPrice);
    if (earlier >= pos.entryPrice * 0.998) continue;

    const lostPct = ((pos.entryPrice - earlier) / earlier) * 100;
    results.push(await persistEntryOptimization({
      positionId: pos.id,
      symbol,
      optimizationType: "LATE_ENTRY",
      earlierEntryPrice: earlier,
      actualEntryPrice: pos.entryPrice,
      lostOpportunityPct: Number(lostPct.toFixed(4)),
    }));
  }
  return { analyzed: results.length, entries: results };
}
