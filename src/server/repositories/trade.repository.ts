import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

export type TradeHistoryFilter = {
  userId?: string;
  pairSymbol?: string;
  status?: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  limit?: number;
};

export async function listTradeHistory(filter: TradeHistoryFilter = {}) {
  const where: Prisma.TradeOrderWhereInput = {
    userId: filter.userId,
    status: filter.status,
    tradingPair: filter.pairSymbol ? { symbol: filter.pairSymbol } : undefined,
  };

  return prisma.tradeOrder.findMany({
    where,
    include: {
      tradingPair: true,
      tradeSignal: true,
      executions: true,
      position: true,
    },
    orderBy: { createdAt: "desc" },
    take: filter.limit ?? 100,
  });
}

export async function listPendingOrdersByUser(userId: string, limit = 200) {
  return prisma.tradeOrder.findMany({
    where: {
      userId,
      status: {
        in: ["NEW", "PARTIALLY_FILLED"],
      },
    },
    include: {
      tradingPair: true,
      position: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
