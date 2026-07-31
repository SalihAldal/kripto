import { prisma } from "@/src/server/db/prisma";

export async function listAiDecisionHistory(input?: { userId?: string; limit?: number }) {
  return prisma.tradeSignal.findMany({
    where: {
      userId: input?.userId,
    },
    include: {
      tradingPair: true,
      aiProvider: true,
      aiModelConfig: true,
      scannerResult: true,
    },
    orderBy: { decidedAt: "desc" },
    take: input?.limit ?? 100,
  });
}
