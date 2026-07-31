import { prisma } from "@/src/server/db/prisma";

export type TradeEventLogInput = {
  positionId?: string | null;
  symbol: string;
  eventType: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  aiConfidence?: number | null;
  price?: number | null;
};

export async function addTradeEventLog(input: TradeEventLogInput) {
  return prisma.tradeEventLog.create({
    data: {
      positionId: input.positionId ?? null,
      symbol: input.symbol,
      eventType: input.eventType,
      oldValue: input.oldValue as never,
      newValue: input.newValue as never,
      reason: input.reason ?? null,
      aiConfidence: input.aiConfidence ?? null,
      price: input.price ?? null,
    },
  });
}

export async function listTradeEventLogs(input?: {
  limit?: number;
  positionId?: string;
  symbol?: string;
  eventType?: string;
}) {
  const limit = Math.max(1, Math.min(300, Number(input?.limit ?? 120)));
  return prisma.tradeEventLog.findMany({
    where: {
      positionId: input?.positionId,
      symbol: input?.symbol ? input.symbol.toUpperCase() : undefined,
      eventType: input?.eventType,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
