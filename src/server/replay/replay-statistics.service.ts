import type { Prisma, ReplayJobCadence } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

const CORRECT_VERDICTS = new Set(["CORRECT", "PARTIALLY_CORRECT"]);

export async function aggregateDecisionAccuracy(input: { periodStart: Date; periodEnd: Date }) {
  const replays = await prisma.decisionReplay.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { gte: input.periodStart, lte: input.periodEnd },
    },
    include: {
      evaluation: true,
      decision: true,
    },
    take: 50_000,
  });

  type Bucket = {
    total: number;
    correct: number;
    partial: number;
    wrong: number;
    missed: number;
    missedProfit: number;
    confidence: number;
  };

  const buckets = new Map<string, Bucket>();

  const add = (dimension: string, key: string, replay: (typeof replays)[number]) => {
    const bucketKey = `${dimension}:${key}`;
    const row = buckets.get(bucketKey) ?? { total: 0, correct: 0, partial: 0, wrong: 0, missed: 0, missedProfit: 0, confidence: 0 };
    row.total += 1;
    const verdict = replay.evaluation?.verdict ?? "UNKNOWN";
    if (verdict === "CORRECT") row.correct += 1;
    else if (verdict === "PARTIALLY_CORRECT") row.partial += 1;
    else if (String(verdict).startsWith("MISSED")) {
      row.missed += 1;
      row.wrong += 1;
    } else if (!CORRECT_VERDICTS.has(verdict)) row.wrong += 1;
    row.missedProfit += Number(replay.evaluation?.missedProfitPct ?? 0);
    row.confidence += Number(replay.decision.confidence ?? 0);
    buckets.set(bucketKey, row);
  };

  for (const replay of replays) {
    const d = replay.decision;
    add("strategy", d.strategyUsed ?? "unknown", replay);
    add("regime", extractRegime(d.marketState) ?? "unknown", replay);
    add("symbol", d.symbol, replay);
    add("decision", d.decision, replay);
    add("weekday", d.timestamp.toLocaleDateString("en-US", { weekday: "long" }), replay);
    add("hour", String(d.timestamp.getUTCHours()), replay);
    add("scanner", d.scannerScore != null && d.scannerScore >= 70 ? "high" : "low", replay);
    add("volatility_regime", d.riskScore != null && d.riskScore >= 70 ? "high_risk" : "normal", replay);
    add("timeframe", "decision_timestamp", replay);
    const metadata = d.metadata as Record<string, unknown> | null;
    const roleScores = Array.isArray(metadata?.roleScores) ? metadata!.roleScores : [];
    for (const role of roleScores as Array<{ role?: string }>) {
      if (role.role) add("model", role.role, replay);
    }
  }

  const rows: Prisma.DecisionAccuracyCreateManyInput[] = [];
  for (const [compound, stats] of buckets.entries()) {
    const [dimension, dimensionKey] = compound.split(":");
    rows.push({
      dimension,
      dimensionKey,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      totalDecisions: stats.total,
      correctCount: stats.correct,
      partiallyCorrectCount: stats.partial,
      wrongCount: stats.wrong,
      missedWinnerCount: stats.missed,
      accuracyPct: stats.total > 0 ? Number((((stats.correct + stats.partial * 0.5) / stats.total) * 100).toFixed(2)) : null,
      avgMissedProfitPct: stats.total > 0 ? Number((stats.missedProfit / stats.total).toFixed(4)) : null,
      avgConfidence: stats.total > 0 ? Number((stats.confidence / stats.total).toFixed(2)) : null,
    });
  }

  if (rows.length > 0) {
    await prisma.decisionAccuracy.deleteMany({
      where: { periodStart: input.periodStart, periodEnd: input.periodEnd },
    });
    await prisma.decisionAccuracy.createMany({ data: rows });
  }
  return rows.length;
}

export async function aggregateRejectAccuracy(input: { periodStart: Date; periodEnd: Date }) {
  const replays = await prisma.decisionReplay.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { gte: input.periodStart, lte: input.periodEnd },
      decision: { executionAllowed: false },
    },
    include: {
      evaluation: true,
      decision: { include: { rejectReasonRows: true } },
    },
    take: 50_000,
  });

  type Bucket = { total: number; correct: number; wrong: number; missedProfit: number };
  const buckets = new Map<string, Bucket>();

  for (const replay of replays) {
    const verdict = replay.evaluation?.verdict ?? "UNKNOWN";
    const correct = CORRECT_VERDICTS.has(verdict);
    const reasons = replay.decision.rejectReasonRows;
    const targets = reasons.length > 0 ? reasons : [{ category: "general", reason: "unspecified", weight: 0.5 }];
    for (const reason of targets) {
      const key = reason.category;
      const row = buckets.get(key) ?? { total: 0, correct: 0, wrong: 0, missedProfit: 0 };
      row.total += 1;
      if (correct) row.correct += 1;
      else row.wrong += 1;
      row.missedProfit += Number(replay.evaluation?.missedProfitPct ?? 0);
      buckets.set(key, row);
    }
  }

  const rows: Prisma.RejectAccuracyCreateManyInput[] = [];
  for (const [rejectCategory, stats] of buckets.entries()) {
    rows.push({
      rejectCategory,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      totalRejects: stats.total,
      correctCount: stats.correct,
      wrongCount: stats.wrong,
      correctPct: stats.total > 0 ? Number(((stats.correct / stats.total) * 100).toFixed(2)) : null,
      wrongPct: stats.total > 0 ? Number(((stats.wrong / stats.total) * 100).toFixed(2)) : null,
      avgMissedProfitPct: stats.total > 0 ? Number((stats.missedProfit / stats.total).toFixed(4)) : null,
      totalMissedProfitPct: Number(stats.missedProfit.toFixed(4)),
    });
  }

  if (rows.length > 0) {
    await prisma.rejectAccuracy.deleteMany({
      where: { periodStart: input.periodStart, periodEnd: input.periodEnd },
    });
    await prisma.rejectAccuracy.createMany({ data: rows });
  }
  return rows.length;
}

export async function aggregateReplayStatistics(input: {
  periodStart: Date;
  periodEnd: Date;
  cadence: ReplayJobCadence;
}) {
  const [completed, pending, failed, evaluations, missed, accuracyRows] = await Promise.all([
    prisma.decisionReplay.count({ where: { status: "COMPLETED", completedAt: { gte: input.periodStart, lte: input.periodEnd } } }),
    prisma.decisionReplay.count({ where: { status: "PENDING" } }),
    prisma.decisionReplay.count({ where: { status: "FAILED", updatedAt: { gte: input.periodStart, lte: input.periodEnd } } }),
    prisma.decisionEvaluation.findMany({
      where: { createdAt: { gte: input.periodStart, lte: input.periodEnd } },
      include: { replay: { include: { decision: true } } },
      take: 5000,
    }),
    prisma.missedOpportunity.findMany({
      where: { createdAt: { gte: input.periodStart, lte: input.periodEnd } },
      orderBy: { missedProfitPct: "desc" },
      take: 50,
    }),
    prisma.decisionAccuracy.findMany({
      where: { periodStart: input.periodStart, periodEnd: input.periodEnd },
    }),
  ]);

  const correct = evaluations.filter((row) => CORRECT_VERDICTS.has(row.verdict)).length;
  const avgAccuracyPct = evaluations.length > 0 ? Number(((correct / evaluations.length) * 100).toFixed(2)) : null;
  const falseRejectCount = evaluations.filter((row) =>
    ["WRONG", "MISSED_WINNER", "MISSED_BREAKOUT", "MISSED_PUMP"].includes(row.verdict),
  ).length;

  const bestDecisions = [...evaluations]
    .sort((a, b) => Number(b.peakProfitPct ?? 0) - Number(a.peakProfitPct ?? 0))
    .slice(0, 20)
    .map((row) => ({
      decisionId: row.decisionId,
      symbol: row.replay.symbol,
      verdict: row.verdict,
      peakProfitPct: row.peakProfitPct,
    }));

  const worstDecisions = [...evaluations]
    .sort((a, b) => Number(a.maePct ?? 0) - Number(b.maePct ?? 0))
    .slice(0, 20)
    .map((row) => ({
      decisionId: row.decisionId,
      symbol: row.replay.symbol,
      verdict: row.verdict,
      maePct: row.maePct,
      missedProfitPct: row.missedProfitPct,
    }));

  const byStrategy = groupAccuracy(accuracyRows.filter((row) => row.dimension === "strategy"));
  const byRegime = groupAccuracy(accuracyRows.filter((row) => row.dimension === "regime"));
  const bySymbol = groupAccuracy(accuracyRows.filter((row) => row.dimension === "symbol"));
  const byTimeframe = groupAccuracy(accuracyRows.filter((row) => row.dimension === "timeframe"));

  return prisma.replayStatistics.create({
    data: {
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      cadence: input.cadence,
      totalReplayed: completed,
      totalPending: pending,
      totalFailed: failed,
      avgAccuracyPct,
      missedWinnersCount: missed.length,
      falseRejectCount,
      bestDecisions: asJson(bestDecisions),
      worstDecisions: asJson(worstDecisions),
      byStrategy: asJson(byStrategy),
      byRegime: asJson(byRegime),
      bySymbol: asJson(bySymbol),
      byTimeframe: asJson(byTimeframe),
      metadata: asJson({ generatedAt: new Date().toISOString() }),
    },
  });
}

function groupAccuracy(rows: Array<{ dimensionKey: string; accuracyPct: number | null; totalDecisions: number }>) {
  return rows
    .sort((a, b) => Number(b.accuracyPct ?? 0) - Number(a.accuracyPct ?? 0))
    .slice(0, 50)
    .map((row) => ({
      key: row.dimensionKey,
      accuracyPct: row.accuracyPct,
      totalDecisions: row.totalDecisions,
    }));
}

function extractRegime(marketState: unknown) {
  if (!marketState || typeof marketState !== "object") return null;
  const state = marketState as Record<string, unknown>;
  if (typeof state.mode === "string") return state.mode;
  if (typeof state.marketRegime === "string") return state.marketRegime;
  return null;
}

export async function runFullStatisticsAggregation(input?: { periodDays?: number; cadence?: ReplayJobCadence }) {
  const periodDays = Math.max(1, input?.periodDays ?? 7);
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60_000);
  const cadence = input?.cadence ?? "DAILY";

  const [accuracyCount, rejectCount, stats] = await Promise.all([
    aggregateDecisionAccuracy({ periodStart, periodEnd }),
    aggregateRejectAccuracy({ periodStart, periodEnd }),
    aggregateReplayStatistics({ periodStart, periodEnd, cadence }),
  ]);

  return { accuracyCount, rejectCount, statsId: stats.id };
}
