import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { PositionSizingResult } from "@/src/server/execution-management/execution-management.types";

export async function persistPositionSizing(input: {
  executionId?: string;
  userId?: string;
  symbol: string;
  side: string;
  sizing: PositionSizingResult;
  quoteAsset: string;
  baseAsset: string;
}) {
  return prisma.positionSizing.create({
    data: {
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      mode: input.sizing.mode,
      quoteAsset: input.quoteAsset,
      baseAsset: input.baseAsset,
      availableQuote: input.sizing.availableQuote,
      availableBase: input.sizing.availableBase,
      sizedQty: input.sizing.sizedQty,
      quoteSpend: input.sizing.quoteSpend,
      utilizationPct: input.sizing.utilizationPct,
      metadata: input.sizing.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistExecutionValidation(input: {
  executionId: string;
  symbol: string;
  side: string;
  passed: boolean;
  reasons: string[];
  marketPrice?: number;
  notional?: number;
  adjustedQty?: number;
  minNotional?: number;
  feesEstimate?: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.executionValidation.create({
    data: {
      executionId: input.executionId,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      stage: "COMPLETE",
      passed: input.passed,
      reasons: input.reasons,
      marketPrice: input.marketPrice,
      notional: input.notional,
      adjustedQty: input.adjustedQty,
      minNotional: input.minNotional,
      feesEstimate: input.feesEstimate,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistExecutionReplay(input: {
  executionId: string;
  orderId?: string;
  symbol: string;
  side: string;
  mode: string;
  requestedQty?: number;
  executedQty?: number;
  requestedPrice?: number;
  executionPrice?: number;
  slippagePct?: number;
  fees?: number;
  fillRatio?: number;
  positionBefore?: unknown;
  positionAfter?: unknown;
  metadata?: Record<string, unknown>;
}) {
  return prisma.executionReplay.create({ data: input as never });
}

export async function listExecutionReplays(input?: { executionId?: string; limit?: number }) {
  return prisma.executionReplay.findMany({
    where: input?.executionId ? { executionId: input.executionId } : undefined,
    orderBy: { replayedAt: "desc" },
    take: input?.limit ?? 100,
  });
}

export async function persistPortfolioSnapshot(input: {
  userId: string;
  mode: string;
  totalValueQuote?: number;
  availableQuote?: number;
  lockedQuote?: number;
  positions?: unknown;
  allocations?: unknown;
  metadata?: Record<string, unknown>;
}) {
  return prisma.portfolioSnapshot.create({
    data: {
      userId: input.userId,
      mode: input.mode,
      totalValueQuote: input.totalValueQuote,
      availableQuote: input.availableQuote,
      lockedQuote: input.lockedQuote,
      positions: input.positions as Prisma.InputJsonValue,
      allocations: input.allocations as Prisma.InputJsonValue,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function upsertCapitalAllocation(input: {
  userId: string;
  asset: string;
  symbol?: string;
  allocatedPct?: number;
  allocatedAmount?: number;
  mode?: string;
}) {
  const existing = await prisma.capitalAllocation.findFirst({
    where: { userId: input.userId, asset: input.asset.toUpperCase() },
  });
  if (existing) {
    return prisma.capitalAllocation.update({
      where: { id: existing.id },
      data: {
        allocatedPct: input.allocatedPct ?? existing.allocatedPct,
        allocatedAmount: input.allocatedAmount ?? existing.allocatedAmount,
        mode: input.mode ?? existing.mode,
        symbol: input.symbol ?? existing.symbol,
      },
    });
  }
  return prisma.capitalAllocation.create({
    data: {
      userId: input.userId,
      asset: input.asset.toUpperCase(),
      symbol: input.symbol,
      allocatedPct: input.allocatedPct ?? 100,
      allocatedAmount: input.allocatedAmount,
      mode: input.mode ?? "ALL_IN",
    },
  });
}

export async function listCapitalAllocations(userId: string) {
  return prisma.capitalAllocation.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
}

export async function listExecutionStatistics(limit = 30) {
  return prisma.executionStatistics.findMany({ orderBy: { computedAt: "desc" }, take: limit });
}

export async function listPortfolioSnapshots(userId: string, limit = 50) {
  return prisma.portfolioSnapshot.findMany({
    where: { userId },
    orderBy: { snapshotAt: "desc" },
    take: limit,
  });
}

export async function listExecutionValidations(executionId: string) {
  return prisma.executionValidation.findMany({ where: { executionId }, orderBy: { validatedAt: "asc" } });
}
