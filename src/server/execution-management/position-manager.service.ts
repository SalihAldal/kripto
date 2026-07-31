import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { PositionSnapshot } from "@/src/server/execution-management/execution-management.types";

function minutesBetween(from: Date, to = new Date()) {
  return Math.max(0, (to.getTime() - from.getTime()) / 60000);
}

export async function getPositionSnapshot(positionId: string): Promise<PositionSnapshot | null> {
  const row = await prisma.position.findUnique({
    where: { id: positionId },
    include: { tradingPair: true },
  });
  if (!row) return null;

  const meta = (row.metadata as Record<string, unknown> | null) ?? {};
  const mark = row.markPrice ?? row.entryPrice;
  const currentValue = mark * row.quantity;
  const unrealized = row.side === "LONG" ? (mark - row.entryPrice) * row.quantity : (row.entryPrice - mark) * row.quantity;

  return {
    positionId: row.id,
    symbol: row.tradingPair.symbol,
    quantity: row.quantity,
    averageEntry: row.entryPrice,
    realizedProfit: row.realizedPnl,
    unrealizedProfit: row.unrealizedPnl ?? unrealized,
    currentValue,
    holdingDurationMin: minutesBetween(row.openedAt),
    highestPriceSinceEntry: Number(meta.highestPriceSinceEntry ?? mark),
    lowestPriceSinceEntry: Number(meta.lowestPriceSinceEntry ?? mark),
  };
}

export async function recordPositionHistory(input: {
  positionId: string;
  userId: string;
  symbol: string;
  eventType: string;
  snapshot: PositionSnapshot;
}) {
  return prisma.positionHistory.create({
    data: {
      positionId: input.positionId,
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      eventType: input.eventType,
      quantity: input.snapshot.quantity,
      entryPrice: input.snapshot.averageEntry,
      markPrice: input.snapshot.currentValue / Math.max(input.snapshot.quantity, 1e-8),
      realizedPnl: input.snapshot.realizedProfit,
      unrealizedPnl: input.snapshot.unrealizedProfit,
      currentValue: input.snapshot.currentValue,
      holdingMinutes: input.snapshot.holdingDurationMin,
      highestPrice: input.snapshot.highestPriceSinceEntry,
      lowestPrice: input.snapshot.lowestPriceSinceEntry,
    },
  });
}

export async function syncOpenPositions(userId: string) {
  const rows = await prisma.position.findMany({
    where: { userId, status: "OPEN" },
    include: { tradingPair: true },
  });
  let synced = 0;
  for (const row of rows) {
    const snapshot = await getPositionSnapshot(row.id);
    if (!snapshot) continue;
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const highest = Math.max(Number(meta.highestPriceSinceEntry ?? row.entryPrice), row.markPrice ?? row.entryPrice);
    const lowest = Math.min(Number(meta.lowestPriceSinceEntry ?? row.entryPrice), row.markPrice ?? row.entryPrice);
    await prisma.position.update({
      where: { id: row.id },
      data: {
        metadata: { ...meta, highestPriceSinceEntry: highest, lowestPriceSinceEntry: lowest } as Prisma.InputJsonValue,
      },
    });
    await recordPositionHistory({
      positionId: row.id,
      userId,
      symbol: row.tradingPair.symbol,
      eventType: "SYNC",
      snapshot: { ...snapshot, highestPriceSinceEntry: highest, lowestPriceSinceEntry: lowest },
    });
    synced += 1;
  }
  return { synced };
}

export async function listCurrentPositions(userId: string) {
  const rows = await prisma.position.findMany({
    where: { userId, status: "OPEN" },
    include: { tradingPair: true },
    orderBy: { openedAt: "desc" },
  });
  const snapshots = [];
  for (const row of rows) {
    const snapshot = await getPositionSnapshot(row.id);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}
