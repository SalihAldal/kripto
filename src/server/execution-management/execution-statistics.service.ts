import { prisma } from "@/src/server/db/prisma";
import { resolveBalancesForMode } from "@/src/server/execution-management/balance-resolver.service";
import { listCurrentPositions, syncOpenPositions } from "@/src/server/execution-management/position-manager.service";
import { persistPortfolioSnapshot, upsertCapitalAllocation } from "@/src/server/execution-management/execution-management.repository";

export async function aggregateExecutionStatistics(periodHours = 24) {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - periodHours * 60 * 60 * 1000);

  const [orders, validations, replays] = await Promise.all([
    prisma.tradeOrder.findMany({
      where: { createdAt: { gte: periodStart, lte: periodEnd } },
      include: { executions: true },
    }),
    prisma.executionValidation.findMany({ where: { validatedAt: { gte: periodStart, lte: periodEnd } } }),
    prisma.executionReplay.findMany({ where: { replayedAt: { gte: periodStart, lte: periodEnd } } }),
  ]);

  const filled = orders.filter((row) => row.status === "FILLED").length;
  const rejected = validations.filter((row) => !row.passed).length;
  const failed = orders.filter((row) => row.status === "REJECTED" || row.status === "CANCELED").length;
  const successRate = orders.length > 0 ? (filled / orders.length) * 100 : 0;
  const avgSlippagePct =
    replays.length > 0 ? replays.reduce((sum, row) => sum + (row.slippagePct ?? 0), 0) / replays.length : 0;
  const avgFillTimeMs = 0;
  const balanceUtilization =
    validations.length > 0
      ? validations.reduce((sum, row) => sum + (row.notional ?? 0), 0) / Math.max(validations.length, 1)
      : 0;
  const executionQuality = Math.max(0, 100 - avgSlippagePct * 10 - failed * 2);

  return prisma.executionStatistics.create({
    data: {
      periodStart,
      periodEnd,
      mode: "all",
      successRate,
      avgSlippagePct,
      avgFillTimeMs,
      rejectedOrders: rejected,
      failedOrders: failed,
      balanceUtilization,
      dustBalance: 0,
      executionQuality,
      metadata: { orders: orders.length, replays: replays.length },
    },
  });
}

export async function capturePortfolioSnapshot(userId: string, mode: "live" | "paper" = "live") {
  const positions = await listCurrentPositions(userId);
  const balances = await resolveBalancesForMode({
    userId,
    mode,
    quoteAsset: "TRY",
    baseAsset: "BTC",
  }).catch(() => ({ availableQuote: 0, availableBase: 0, lockedQuote: 0, lockedBase: 0 }));

  const totalValueQuote =
    balances.availableQuote +
    positions.reduce((sum, row) => sum + row.currentValue, 0);

  await upsertCapitalAllocation({
    userId,
    asset: "TRY",
    allocatedPct: 100,
    allocatedAmount: balances.availableQuote,
    mode: "ALL_IN",
  });

  return persistPortfolioSnapshot({
    userId,
    mode,
    totalValueQuote,
    availableQuote: balances.availableQuote,
    lockedQuote: balances.lockedQuote,
    positions,
    allocations: [{ asset: "TRY", pct: 100, mode: "ALL_IN" }],
  });
}

export async function runPositionSync(userId: string) {
  return syncOpenPositions(userId);
}
