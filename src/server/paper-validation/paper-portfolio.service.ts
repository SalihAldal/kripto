import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { getPaperAccount } from "@/src/server/simulation/paper-trading.service";
import {
  ensurePaperPortfolio,
  updatePaperPortfolio,
} from "@/src/server/paper-validation/paper-validation.repository";

export async function syncPaperPortfolio(userId: string) {
  const account = await getPaperAccount(userId);
  const quoteAssets = ["TRY", "USDT"];
  let totalBalance = 0;
  for (const asset of quoteAssets) {
    totalBalance += Number(account.balances[asset] ?? 0);
  }

  const openPositions = await prisma.position.findMany({
    where: {
      userId,
      status: "OPEN",
    },
    select: {
      quantity: true,
      entryPrice: true,
      markPrice: true,
      unrealizedPnl: true,
      feeTotal: true,
      metadata: true,
    },
  });

  const paperPositions = openPositions.filter((p) => {
    const mode = String((p.metadata as Record<string, unknown> | null)?.mode ?? "");
    return mode === "paper" || env.EXECUTION_MODE === "paper";
  });

  let lockedBalance = 0;
  let unrealizedPnl = 0;
  for (const pos of paperPositions) {
    lockedBalance += pos.quantity * pos.entryPrice;
    unrealizedPnl += pos.unrealizedPnl;
  }

  const closedPaperTrades = await prisma.paperTrade.findMany({
    where: { userId, status: "CLOSED" },
    select: { realizedPnl: true, fees: true, slippagePct: true },
  });

  const totalPnl = closedPaperTrades.reduce((s, t) => s + t.realizedPnl, 0);
  const totalFees = closedPaperTrades.reduce((s, t) => s + t.fees, 0);
  const totalSlippage = closedPaperTrades.reduce((s, t) => s + t.slippagePct, 0);

  return updatePaperPortfolio({
    userId,
    balance: totalBalance + lockedBalance,
    availableBalance: totalBalance,
    lockedBalance,
    totalPnl,
    totalFees,
    totalSlippage,
    unrealizedPnl,
    positionCount: paperPositions.length,
    metadata: {
      balances: account.balances,
      syncedAt: new Date().toISOString(),
    },
  });
}

export async function syncAllPaperPortfolios() {
  const userIds = await prisma.paperTrade.findMany({
    distinct: ["userId"],
    select: { userId: true },
    take: 100,
  });

  const synced = [];
  for (const { userId } of userIds) {
    synced.push(await syncPaperPortfolio(userId));
  }
  return { synced: synced.length };
}

export async function getPaperPortfolio(userId: string) {
  await syncPaperPortfolio(userId);
  return ensurePaperPortfolio(userId);
}
