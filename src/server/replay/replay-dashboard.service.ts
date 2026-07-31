import { prisma } from "@/src/server/db/prisma";
import type { ReplayDashboardSummary } from "@/src/server/replay/replay.types";

export async function getReplayDashboard(input?: { periodDays?: number }): Promise<ReplayDashboardSummary> {
  const periodDays = Math.max(1, input?.periodDays ?? 7);
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60_000);

  const [latestStats, missedWinners, falseRejects, best, worst, accuracyRows, rejectRows, weights] =
    await Promise.all([
      prisma.replayStatistics.findFirst({ orderBy: { computedAt: "desc" } }),
      prisma.missedOpportunity.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { missedProfitPct: "desc" },
        take: 25,
      }),
      prisma.decisionEvaluation.findMany({
        where: {
          createdAt: { gte: since },
          verdict: { in: ["WRONG", "MISSED_WINNER", "MISSED_BREAKOUT", "MISSED_PUMP"] },
        },
        include: { replay: { include: { decision: { include: { rejectReasonRows: true } } } } },
        orderBy: { missedProfitPct: "desc" },
        take: 25,
      }),
      prisma.decisionEvaluation.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { peakProfitPct: "desc" },
        take: 15,
        include: { replay: true },
      }),
      prisma.decisionEvaluation.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { maePct: "asc" },
        take: 15,
        include: { replay: true },
      }),
      prisma.decisionAccuracy.findMany({
        where: { computedAt: { gte: since } },
        orderBy: { accuracyPct: "desc" },
        take: 200,
      }),
      prisma.rejectAccuracy.findMany({
        where: { computedAt: { gte: since } },
        orderBy: { computedAt: "desc" },
        take: 50,
      }),
      prisma.weightRecommendation.findMany({
        orderBy: { computedAt: "desc" },
        take: 30,
      }),
    ]);

  const [totalReplayed, totalPending, totalFailed] = await Promise.all([
    prisma.decisionReplay.count({ where: { status: "COMPLETED", completedAt: { gte: since } } }),
    prisma.decisionReplay.count({ where: { status: "PENDING" } }),
    prisma.decisionReplay.count({ where: { status: "FAILED", updatedAt: { gte: since } } }),
  ]);

  return {
    replaySummary: {
      totalReplayed,
      totalPending,
      totalFailed,
      avgAccuracyPct: latestStats?.avgAccuracyPct ?? null,
      missedWinnersCount: latestStats?.missedWinnersCount ?? missedWinners.length,
      falseRejectCount: latestStats?.falseRejectCount ?? falseRejects.length,
    },
    missedWinners: missedWinners.map(serializeMissed),
    falseRejects: falseRejects.map(serializeFalseReject),
    worstDecisions: worst.map(serializeEvaluation),
    bestDecisions: best.map(serializeEvaluation),
    accuracyByStrategy: accuracyRows.filter((row) => row.dimension === "strategy").map(serializeAccuracy),
    accuracyByMarketRegime: accuracyRows.filter((row) => row.dimension === "regime").map(serializeAccuracy),
    accuracyBySymbol: accuracyRows.filter((row) => row.dimension === "symbol").map(serializeAccuracy),
    accuracyByTimeframe: accuracyRows.filter((row) => row.dimension === "timeframe").map(serializeAccuracy),
    rejectAccuracy: rejectRows.map(serializeRejectAccuracy),
    weightRecommendations: weights.map(serializeWeight),
  };
}

function serializeMissed(row: Awaited<ReturnType<typeof prisma.missedOpportunity.findMany>>[number]) {
  return {
    symbol: row.symbol,
    decisionId: row.decisionId,
    decisionTime: row.decisionTime.toISOString(),
    priceAtDecision: row.priceAtDecision,
    highestPrice: row.highestPrice,
    lowestPrice: row.lowestPrice,
    bestReturn: row.bestReturnPct,
    worstReturn: row.worstReturnPct,
    missedProfit: row.missedProfitPct,
    missedLoss: row.missedLossPct,
    classification: row.classification,
    confidence: row.confidence,
    marketRegime: row.marketRegime,
    reasonRejected: row.reasonRejected,
    horizonBreakdown: row.horizonBreakdown,
  };
}

function serializeFalseReject(
  row: Awaited<ReturnType<typeof prisma.decisionEvaluation.findMany>>[number] & {
    replay: { symbol: string; decision: { rejectReasonRows: Array<{ reason: string; category: string }> } };
  },
) {
  return {
    decisionId: row.decisionId,
    symbol: row.replay.symbol,
    verdict: row.verdict,
    missedProfitPct: row.missedProfitPct,
    summary: row.summary,
    rejectReasons: row.replay.decision.rejectReasonRows.map((reason) => ({
      reason: reason.reason,
      category: reason.category,
    })),
  };
}

function serializeEvaluation(row: Awaited<ReturnType<typeof prisma.decisionEvaluation.findMany>>[number] & {
  replay: { symbol: string };
}) {
  return {
    decisionId: row.decisionId,
    symbol: row.replay.symbol,
    verdict: row.verdict,
    peakProfitPct: row.peakProfitPct,
    maePct: row.maePct,
    missedProfitPct: row.missedProfitPct,
    summary: row.summary,
  };
}

function serializeAccuracy(row: Awaited<ReturnType<typeof prisma.decisionAccuracy.findMany>>[number]) {
  return {
    key: row.dimensionKey,
    dimension: row.dimension,
    totalDecisions: row.totalDecisions,
    accuracyPct: row.accuracyPct,
    missedWinnerCount: row.missedWinnerCount,
    avgMissedProfitPct: row.avgMissedProfitPct,
  };
}

function serializeRejectAccuracy(row: Awaited<ReturnType<typeof prisma.rejectAccuracy.findMany>>[number]) {
  return {
    rejectCategory: row.rejectCategory,
    totalRejects: row.totalRejects,
    correctPct: row.correctPct,
    wrongPct: row.wrongPct,
    avgMissedProfitPct: row.avgMissedProfitPct,
    totalMissedProfitPct: row.totalMissedProfitPct,
  };
}

function serializeWeight(row: Awaited<ReturnType<typeof prisma.weightRecommendation.findMany>>[number]) {
  return {
    filterName: row.filterName,
    rejectCategory: row.rejectCategory,
    currentWeight: row.currentWeight,
    suggestedWeight: row.suggestedWeight,
    currentThreshold: row.currentThreshold,
    suggestedThreshold: row.suggestedThreshold,
    expectedProfitFactorDelta: row.expectedProfitFactorDelta,
    expectedTradeIncreasePct: row.expectedTradeIncreasePct,
    sampleSize: row.sampleSize,
    confidence: row.confidence,
    rationale: row.rationale,
    computedAt: row.computedAt.toISOString(),
  };
}

export async function getReplayByDecisionId(decisionId: string) {
  return prisma.decisionReplay.findFirst({
    where: { decisionId },
    orderBy: { createdAt: "desc" },
    include: {
      evaluation: true,
      missedOpportunity: true,
      historicalOutcomes: { orderBy: { horizonMs: "asc" } },
      attributions: { orderBy: { rank: "asc" } },
    },
  });
}
