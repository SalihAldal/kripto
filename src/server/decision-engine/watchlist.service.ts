import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { MasterDecisionOutput } from "@/src/server/decision-engine/decision-engine.types";
import { WATCHLIST_RECHECK_INTERVALS_MIN } from "@/src/server/decision-engine/decision-engine.types";

export async function enqueueWatchlistIfNeeded(output: MasterDecisionOutput) {
  const existing = await prisma.decisionWatchlist.findFirst({
    where: { symbol: output.symbol, status: "ACTIVE" },
  });
  if (existing) return existing;

  const nextRecheckAt = new Date(Date.now() + WATCHLIST_RECHECK_INTERVALS_MIN[0] * 60 * 1000);
  return prisma.decisionWatchlist.create({
    data: {
      symbol: output.symbol,
      decisionId: output.decisionId,
      status: "ACTIVE",
      recheckIntervalMin: WATCHLIST_RECHECK_INTERVALS_MIN[0],
      nextRecheckAt,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      payload: {
        matrix: output.matrix,
        confidence: output.confidence,
        recheckPlan: WATCHLIST_RECHECK_INTERVALS_MIN,
      } as Prisma.InputJsonValue,
    },
  });
}

export async function advanceWatchlistRecheck(id: string, promoted: boolean) {
  if (promoted) {
    return prisma.decisionWatchlist.update({
      where: { id },
      data: { status: "PROMOTED", nextRecheckAt: null },
    });
  }
  const row = await prisma.decisionWatchlist.findUnique({ where: { id } });
  if (!row) return null;
  const plan = WATCHLIST_RECHECK_INTERVALS_MIN;
  const currentIdx = plan.indexOf(row.recheckIntervalMin as (typeof plan)[number]);
  const nextInterval = plan[Math.min(currentIdx + 1, plan.length - 1)] ?? 30;
  const expired = row.expiresAt && row.expiresAt.getTime() <= Date.now();
  if (expired || nextInterval === row.recheckIntervalMin && currentIdx === plan.length - 1) {
    return prisma.decisionWatchlist.update({
      where: { id },
      data: { status: "EXPIRED", nextRecheckAt: null },
    });
  }
  return prisma.decisionWatchlist.update({
    where: { id },
    data: {
      recheckIntervalMin: nextInterval,
      nextRecheckAt: new Date(Date.now() + nextInterval * 60 * 1000),
    },
  });
}

export async function listDueWatchlist(limit = 20) {
  return prisma.decisionWatchlist.findMany({
    where: {
      status: "ACTIVE",
      nextRecheckAt: { lte: new Date() },
    },
    orderBy: { nextRecheckAt: "asc" },
    take: limit,
  });
}
