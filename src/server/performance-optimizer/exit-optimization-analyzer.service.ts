import { prisma } from "@/src/server/db/prisma";
import { buildPricePath } from "@/src/server/replay/price-path.service";
import { persistExitOptimization } from "@/src/server/performance-optimizer/performance-optimizer.repository";

export async function analyzeEarlyExits(limit = 20) {
  const positions = await prisma.position.findMany({
    where: { status: "CLOSED", side: "LONG", closePrice: { not: null } },
    orderBy: { closedAt: "desc" },
    take: limit,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const results = [];
  for (const pos of positions) {
    const symbol = pos.tradingPair?.symbol ?? "";
    const closedAt = pos.closedAt;
    if (!symbol || !pos.closePrice || !closedAt) continue;

    const path = await buildPricePath({ symbol, decisionTime: closedAt, fallbackPrice: pos.closePrice }).catch(() => null);
    if (!path) continue;

    const afterExit = path.candles.filter((c) => c.openTime >= closedAt.getTime());
    const bestExit = afterExit.reduce((max, c) => Math.max(max, c.high), pos.closePrice);
    if (bestExit <= pos.closePrice * 1.002) continue;

    const actualProfit = ((pos.closePrice - pos.entryPrice) / pos.entryPrice) * 100;
    const bestProfit = ((bestExit - pos.entryPrice) / pos.entryPrice) * 100;
    const lostProfit = bestProfit - actualProfit;

    results.push(await persistExitOptimization({
      positionId: pos.id,
      symbol,
      optimizationType: "EARLY_EXIT",
      bestExitPrice: bestExit,
      actualExitPrice: pos.closePrice,
      peakProfitPct: Number(bestProfit.toFixed(4)),
      actualProfitPct: Number(actualProfit.toFixed(4)),
      lostProfitPct: Number(lostProfit.toFixed(4)),
    }));
  }
  return { analyzed: results.length, exits: results };
}

export async function analyzeLateExits(limit = 20) {
  const positions = await prisma.position.findMany({
    where: { status: "CLOSED", side: "LONG", closePrice: { not: null } },
    orderBy: { closedAt: "desc" },
    take: limit,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  const results = [];
  for (const pos of positions) {
    const symbol = pos.tradingPair?.symbol ?? "";
    if (!symbol || !pos.closePrice || !pos.closedAt) continue;

    const path = await buildPricePath({ symbol, decisionTime: pos.openedAt, fallbackPrice: pos.entryPrice }).catch(() => null);
    if (!path) continue;

    const during = path.candles.filter((c) => c.openTime >= pos.openedAt.getTime() && c.openTime <= (pos.closedAt?.getTime() ?? Date.now()));
    const peak = during.reduce((max, c) => Math.max(max, c.high), pos.entryPrice);
    const peakProfit = ((peak - pos.entryPrice) / pos.entryPrice) * 100;
    const actualProfit = ((pos.closePrice - pos.entryPrice) / pos.entryPrice) * 100;
    const giveback = peakProfit - actualProfit;
    if (giveback < 0.5) continue;

    results.push(await persistExitOptimization({
      positionId: pos.id,
      symbol,
      optimizationType: "LATE_EXIT",
      bestExitPrice: peak,
      actualExitPrice: pos.closePrice,
      peakProfitPct: Number(peakProfit.toFixed(4)),
      actualProfitPct: Number(actualProfit.toFixed(4)),
      lostProfitPct: Number(giveback.toFixed(4)),
      profitGivebackPct: Number(giveback.toFixed(4)),
    }));
  }
  return { analyzed: results.length, exits: results };
}
