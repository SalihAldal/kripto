import type { Prisma } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { calculatePaperAccuracy } from "@/src/server/paper-validation/paper-accuracy.service";
import { fetchReplayAccuracyMetrics } from "@/src/server/quant-research/replay-bridge.service";
import type { LiveReadinessResult } from "@/src/server/paper-validation/paper-validation.types";

export async function calculateLiveReadiness(userId: string, reportDate = new Date()) {
  const dayStart = new Date(Date.UTC(reportDate.getUTCFullYear(), reportDate.getUTCMonth(), reportDate.getUTCDate()));

  const trades = await prisma.paperTrade.findMany({
    where: { userId, status: "CLOSED" },
    orderBy: { closedAt: "asc" },
    take: 5000,
  });

  const returns = trades.map((t) => t.returnPct);
  const metrics = computePerformanceMetrics(returns);
  const accuracy = await calculatePaperAccuracy({ userId, limit: 200 });
  const replay = await fetchReplayAccuracyMetrics(90);

  const avgQuality =
    trades.length > 0 ? trades.reduce((s, t) => s + (t.overallScore ?? 0), 0) / trades.length : 0;
  const dataQualityScore = Math.min(100, (trades.filter((t) => t.decisionId).length / Math.max(1, trades.length)) * 100);

  const gates = {
    minTradesMet: trades.length >= env.PAPER_VALIDATION_MIN_TRADES,
    minProfitFactorMet: metrics.profitFactor >= env.PAPER_VALIDATION_MIN_PROFIT_FACTOR,
    minWinRateMet: metrics.winRate >= env.PAPER_VALIDATION_MIN_WIN_RATE,
    maxDrawdownMet: metrics.maxDrawdownPct <= env.PAPER_VALIDATION_MAX_DRAWDOWN_PCT,
    dataQualityMet: dataQualityScore >= env.PAPER_VALIDATION_MIN_DATA_QUALITY,
    executionQualityMet: accuracy.avgFillAccuracy >= env.PAPER_VALIDATION_MIN_EXECUTION_QUALITY,
    replayIntegrityMet: replay.replayAccuracy >= env.PAPER_VALIDATION_MIN_REPLAY_INTEGRITY,
  };

  const gateScores = [
    gates.minTradesMet ? 15 : Math.min(15, (trades.length / env.PAPER_VALIDATION_MIN_TRADES) * 15),
    gates.minProfitFactorMet ? 15 : Math.min(15, (metrics.profitFactor / env.PAPER_VALIDATION_MIN_PROFIT_FACTOR) * 15),
    gates.minWinRateMet ? 15 : Math.min(15, (metrics.winRate / env.PAPER_VALIDATION_MIN_WIN_RATE) * 15),
    gates.maxDrawdownMet ? 15 : Math.max(0, 15 - metrics.maxDrawdownPct),
    gates.dataQualityMet ? 10 : dataQualityScore / 10,
    gates.executionQualityMet ? 15 : accuracy.avgFillAccuracy / 6.67,
    gates.replayIntegrityMet ? 15 : replay.replayAccuracy / 6.67,
  ];

  const readinessScore = Number(Math.min(100, gateScores.reduce((s, v) => s + v, 0)).toFixed(1));
  const allPassed = Object.values(gates).every(Boolean);

  const blockers: string[] = [];
  if (!gates.minTradesMet) blockers.push(`Need ${env.PAPER_VALIDATION_MIN_TRADES} trades (have ${trades.length})`);
  if (!gates.minProfitFactorMet) blockers.push(`Profit factor ${metrics.profitFactor.toFixed(2)} < ${env.PAPER_VALIDATION_MIN_PROFIT_FACTOR}`);
  if (!gates.minWinRateMet) blockers.push(`Win rate ${metrics.winRate.toFixed(1)}% < ${env.PAPER_VALIDATION_MIN_WIN_RATE}%`);
  if (!gates.maxDrawdownMet) blockers.push(`Drawdown ${metrics.maxDrawdownPct.toFixed(1)}% > ${env.PAPER_VALIDATION_MAX_DRAWDOWN_PCT}%`);
  if (!gates.dataQualityMet) blockers.push(`Data quality ${dataQualityScore.toFixed(0)}% < ${env.PAPER_VALIDATION_MIN_DATA_QUALITY}%`);
  if (!gates.executionQualityMet) blockers.push(`Execution quality ${accuracy.avgFillAccuracy.toFixed(0)}% < ${env.PAPER_VALIDATION_MIN_EXECUTION_QUALITY}%`);
  if (!gates.replayIntegrityMet) blockers.push(`Replay integrity ${replay.replayAccuracy.toFixed(0)}% < ${env.PAPER_VALIDATION_MIN_REPLAY_INTEGRITY}%`);

  let status: LiveReadinessResult["status"] = "NOT_READY";
  if (allPassed) status = "RECOMMENDED";
  else if (readinessScore >= 70) status = "READY";
  else if (readinessScore >= 40) status = "APPROACHING";

  const recommendation = allPassed
    ? "Live trading candidate — manual confirmation required. System will NOT auto-enable live mode."
    : "Remain in paper mode until all readiness gates pass.";

  const row = await prisma.liveReadiness.upsert({
    where: { userId_reportDate: { userId, reportDate: dayStart } },
    create: {
      userId,
      reportDate: dayStart,
      readinessScore,
      status,
      ...gates,
      recommendation,
      expectedImprovement: allPassed ? metrics.expectancy * 100 : null,
      confidence: allPassed ? 0.85 : readinessScore / 100,
      evidence: { metrics, accuracy, replay, avgQuality, tradeCount: trades.length } as Prisma.InputJsonValue,
      blockers: blockers as Prisma.InputJsonValue,
    },
    update: {
      readinessScore,
      status,
      ...gates,
      recommendation,
      expectedImprovement: allPassed ? metrics.expectancy * 100 : null,
      confidence: allPassed ? 0.85 : readinessScore / 100,
      evidence: { metrics, accuracy, replay, avgQuality, tradeCount: trades.length } as Prisma.InputJsonValue,
      blockers: blockers as Prisma.InputJsonValue,
    },
  });

  return { ...row, gates, blockers, autoLiveEnabled: false } as LiveReadinessResult & { id: string };
}

export async function calculateAllReadinessScores() {
  const userIds = await prisma.paperTrade.findMany({
    distinct: ["userId"],
    select: { userId: true },
    take: 50,
  });

  const results = [];
  for (const { userId } of userIds) {
    results.push(await calculateLiveReadiness(userId));
  }
  return { calculated: results.length, results };
}
