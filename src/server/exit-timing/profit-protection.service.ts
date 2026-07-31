import { prisma } from "@/src/server/db/prisma";
import type { ExitContext, ProfitProtectionSnapshot } from "@/src/server/exit-timing/exit-timing.types";
import { persistProfitProtection } from "@/src/server/exit-timing/exit-timing.repository";

export async function computeProfitProtection(
  ctx: ExitContext,
  analysisId?: string,
): Promise<ProfitProtectionSnapshot & { id: string }> {
  const openProfitPct = ctx.currentProfitPct;
  const lockedProfitPct = Math.max(0, openProfitPct * 0.5);

  const priorSnapshots = ctx.positionId
    ? await prisma.profitProtection.findMany({
        where: { positionId: ctx.positionId },
        orderBy: { recordedAt: "desc" },
        take: 50,
      })
    : [];

  const historicalMax = priorSnapshots.length > 0
    ? Math.max(...priorSnapshots.map((s) => s.maximumProfitPct), openProfitPct)
    : openProfitPct;
  const maximumProfitPct = Math.max(historicalMax, openProfitPct);
  const profitGivebackPct = maximumProfitPct > 0 ? Math.max(0, maximumProfitPct - openProfitPct) : 0;
  const drawdownFromPeakPct = maximumProfitPct > 0 ? (profitGivebackPct / maximumProfitPct) * 100 : 0;

  const snapshot: ProfitProtectionSnapshot = {
    lockedProfitPct: Number(lockedProfitPct.toFixed(4)),
    openProfitPct: Number(openProfitPct.toFixed(4)),
    maximumProfitPct: Number(maximumProfitPct.toFixed(4)),
    profitGivebackPct: Number(profitGivebackPct.toFixed(4)),
    drawdownFromPeakPct: Number(drawdownFromPeakPct.toFixed(2)),
  };

  const record = await persistProfitProtection({
    analysisId,
    positionId: ctx.positionId,
    symbol: ctx.symbol,
    ...snapshot,
  });

  return { id: record.id, ...snapshot };
}
