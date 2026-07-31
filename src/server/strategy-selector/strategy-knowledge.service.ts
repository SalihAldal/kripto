import { prisma } from "@/src/server/db/prisma";
import { learnStrategyPerformance } from "@/src/server/strategy-selector/strategy-learning.service";

export async function syncStrategyPerformance() {
  const closed = await prisma.position.findMany({
    where: { status: "CLOSED", side: "LONG" },
    orderBy: { closedAt: "desc" },
    take: 100,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  let synced = 0;
  for (const pos of closed) {
    const symbol = pos.tradingPair?.symbol;
    if (!symbol) continue;
    const selection = await prisma.adaptiveStrategySelection.findFirst({
      where: { symbol, selectedAt: { lte: pos.openedAt } },
      orderBy: { selectedAt: "desc" },
    });
    if (selection && pos.realizedPnl !== 0) synced += 1;
  }

  const learning = await learnStrategyPerformance();
  return { positionsScanned: closed.length, synced, learning };
}

export async function updateStrategyKnowledgeBase() {
  return learnStrategyPerformance();
}
