import { prisma } from "@/src/server/db/prisma";

export async function listOpenPositions(input?: { userId?: string; symbol?: string; limit?: number }) {
  return prisma.position.findMany({
    where: {
      userId: input?.userId,
      status: "OPEN",
      tradingPair: input?.symbol ? { symbol: input.symbol } : undefined,
    },
    include: {
      tradingPair: true,
      exchangeConnection: true,
      tradeOrders: true,
    },
    orderBy: { openedAt: "desc" },
    take: input?.limit ?? 100,
  });
}
