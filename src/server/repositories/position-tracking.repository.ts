import { prisma } from "@/src/server/db/prisma";

export async function upsertPositionTracking(input: {
  positionId: string;
  symbol: string;
  buyPrice: number;
  currentPrice?: number | null;
  highestPriceAfterBuy?: number | null;
  targetSellPrice?: number | null;
  activeStopPrice?: number | null;
  trailingActive?: boolean;
  profitPercent?: number | null;
  aiLastDecision?: string | null;
  lastAnalysisAt?: Date | null;
  positionStatus?: string;
  metadata?: Record<string, unknown> | null;
}) {
  return prisma.positionTracking.upsert({
    where: { positionId: input.positionId },
    update: {
      symbol: input.symbol,
      buyPrice: input.buyPrice,
      currentPrice: input.currentPrice ?? undefined,
      highestPriceAfterBuy: input.highestPriceAfterBuy ?? undefined,
      targetSellPrice: input.targetSellPrice ?? undefined,
      activeStopPrice: input.activeStopPrice ?? undefined,
      trailingActive: input.trailingActive ?? undefined,
      profitPercent: input.profitPercent ?? undefined,
      aiLastDecision: input.aiLastDecision ?? undefined,
      lastAnalysisAt: input.lastAnalysisAt ?? undefined,
      positionStatus: input.positionStatus ?? undefined,
      metadata: input.metadata as never,
    },
    create: {
      positionId: input.positionId,
      symbol: input.symbol,
      buyPrice: input.buyPrice,
      currentPrice: input.currentPrice ?? null,
      highestPriceAfterBuy: input.highestPriceAfterBuy ?? null,
      targetSellPrice: input.targetSellPrice ?? null,
      activeStopPrice: input.activeStopPrice ?? null,
      trailingActive: input.trailingActive ?? false,
      profitPercent: input.profitPercent ?? null,
      aiLastDecision: input.aiLastDecision ?? null,
      lastAnalysisAt: input.lastAnalysisAt ?? null,
      positionStatus: input.positionStatus ?? "OPEN",
      metadata: input.metadata as never,
    },
  });
}

export async function getPositionTracking(positionId: string) {
  return prisma.positionTracking.findUnique({
    where: { positionId },
  });
}

export async function listPositionTracking(input?: { symbol?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(200, Number(input?.limit ?? 100)));
  return prisma.positionTracking.findMany({
    where: {
      symbol: input?.symbol ? input.symbol.toUpperCase() : undefined,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
}
