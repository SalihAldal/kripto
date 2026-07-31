import { prisma } from "@/src/server/db/prisma";
import { runRestartRecovery } from "@/src/server/recovery/failsafe-recovery.service";
import { upsertLiveTrade } from "@/src/server/live-trading/live-trading.repository";
import { reconcileAllSymbols } from "@/src/server/live-trading/account-reconciliation.service";

export async function recoverLivePositions(userId: string) {
  const recovery = await runRestartRecovery(userId);

  const openPositions = await prisma.position.findMany({
    where: { userId, status: "OPEN" },
    include: { tradingPair: true },
  });

  let synced = 0;
  for (const pos of openPositions) {
    const meta = (pos.metadata as Record<string, unknown> | null) ?? {};
    if (String(meta.mode ?? "") !== "live" && meta.mode !== undefined) continue;

    const tradeKey = `live_pos_${pos.id}`;
    const existing = await prisma.liveTrade.findUnique({ where: { tradeKey } });
    if (existing) continue;

    await upsertLiveTrade({
      tradeKey,
      userId,
      symbol: pos.tradingPair.symbol,
      side: "BUY",
      status: "OPEN",
      entryPrice: pos.entryPrice,
      quantity: pos.quantity,
      positionId: pos.id,
      openedAt: pos.openedAt,
      metadata: { source: "position_recovery", recoveredAt: new Date().toISOString() },
    });
    synced++;
  }

  const pendingOrders = await prisma.tradeOrder.findMany({
    where: { userId, status: { in: ["NEW", "PARTIALLY_FILLED"] } },
    take: 50,
  });

  const reconciliation = await reconcileAllSymbols(userId);

  return {
    recovery,
    syncedPositions: synced,
    openPositions: openPositions.length,
    pendingOrders: pendingOrders.length,
    reconciliation,
  };
}

export async function recoverAllLiveUsers() {
  const userIds = await prisma.position.findMany({
    where: { status: "OPEN" },
    distinct: ["userId"],
    select: { userId: true },
    take: 50,
  });

  const results = [];
  for (const { userId } of userIds) {
    results.push(await recoverLivePositions(userId));
  }
  return { users: results.length, results };
}
