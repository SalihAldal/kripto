import { prisma } from "@/src/server/db/prisma";
import { persistMomentumBreakoutStatistics } from "@/src/server/trading-core-s2/trading-core-s2.repository";
import { emitTradingCoreS2Event, TRADING_CORE_S2_EVENT } from "@/src/server/trading-core-s2/trading-core-s2.events";

function safeNum(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function calculateMomentumBreakoutStatistics(days = 30) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);

  const candidates = await prisma.momentumBreakoutCandidate.findMany({
    where: { evaluatedAt: { gte: periodStart, lte: periodEnd } },
    orderBy: { evaluatedAt: "asc" },
  });

  const replays = await prisma.decisionReplay.findMany({
    where: {
      createdAt: { gte: periodStart, lte: periodEnd },
      symbol: { in: candidates.map((c) => c.symbol) },
      status: "COMPLETED",
    },
    include: {
      evaluation: {
        select: {
          missedProfitPct: true,
          peakProfitPct: true,
          mfePct: true,
          maePct: true,
          verdict: true,
        },
      },
    },
    take: 5000,
  });

  const returns: number[] = [];
  for (const replay of replays) {
    const pnl = safeNum(
      replay.evaluation?.peakProfitPct ??
        replay.evaluation?.mfePct ??
        replay.evaluation?.missedProfitPct,
    );
    if (pnl !== 0) returns.push(pnl);
  }

  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const hitRate = returns.length > 0 ? (wins.length / returns.length) * 100 : 0;
  const averageProfit = wins.length > 0 ? wins.reduce((s, v) => s + v, 0) / wins.length : 0;
  const averageLoss = losses.length > 0 ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;
  const grossProfit = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0;
  const expectancy = returns.length > 0 ? returns.reduce((s, v) => s + v, 0) / returns.length : 0;
  const mean = expectancy;
  const variance =
    returns.length > 1
      ? returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1)
      : 0;
  const std = Math.sqrt(Math.max(variance, 0));
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const stats = await persistMomentumBreakoutStatistics({
    periodStart,
    periodEnd,
    hitRate: Number(hitRate.toFixed(4)),
    averageProfit: Number(averageProfit.toFixed(4)),
    averageLoss: Number(averageLoss.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(4)),
    expectancy: Number(expectancy.toFixed(4)),
    sharpe: Number(sharpe.toFixed(4)),
    maxDrawdown: Number(maxDrawdown.toFixed(4)),
    sampleSize: returns.length,
    metadata: {
      candidateCount: candidates.length,
      replayCount: replays.length,
      buyCandidates: candidates.filter((c) => c.verdict === "BUY_CANDIDATE").length,
      waitCandidates: candidates.filter((c) => c.verdict === "WAIT").length,
    },
  });

  emitTradingCoreS2Event(TRADING_CORE_S2_EVENT.STATISTICS_UPDATED, {
    statsKey: stats.statsKey,
    sampleSize: stats.sampleSize,
    profitFactor: stats.profitFactor,
  });

  return stats;
}
