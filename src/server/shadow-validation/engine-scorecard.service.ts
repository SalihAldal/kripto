import type { ValidationReportCadence } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { EngineScorecard } from "@/src/server/shadow-validation/shadow-validation.types";

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]) {
  if (values.length === 0) return 0;
  const mean = avg(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function sharpe(returns: number[]) {
  const mean = avg(returns);
  const sd = stddev(returns);
  if (sd <= 0) return 0;
  return (mean / sd) * Math.sqrt(returns.length);
}

function sortino(returns: number[]) {
  const mean = avg(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideDev = stddev(downside);
  if (downsideDev <= 0) return mean > 0 ? mean : 0;
  return (mean / downsideDev) * Math.sqrt(returns.length);
}

export async function computeEngineScorecard(input: {
  engineId: string;
  periodStart: Date;
  periodEnd: Date;
  cadence?: ValidationReportCadence;
}): Promise<EngineScorecard> {
  const rows = await prisma.shadowDecision.findMany({
    where: {
      engineId: input.engineId,
      capturedAt: { gte: input.periodStart, lte: input.periodEnd },
      verdict: { not: "PENDING" },
    },
    take: 5000,
  });

  const returns = rows.map((row) => row.profitPct ?? 0);
  const wins = rows.filter((row) => (row.profitPct ?? 0) > 0);
  const losses = rows.filter((row) => (row.profitPct ?? 0) < 0);
  const winRate = rows.length > 0 ? (wins.length / rows.length) * 100 : 0;
  const lossRate = rows.length > 0 ? (losses.length / rows.length) * 100 : 0;
  const grossProfit = wins.reduce((sum, row) => sum + Math.abs(row.profitPct ?? 0), 0);
  const grossLoss = losses.reduce((sum, row) => sum + Math.abs(row.profitPct ?? 0), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0;
  const avgProfitPct = wins.length > 0 ? avg(wins.map((row) => row.profitPct ?? 0)) : 0;
  const avgLossPct = losses.length > 0 ? avg(losses.map((row) => row.profitPct ?? 0)) : 0;
  const expectancy = rows.length > 0 ? avg(returns) : 0;
  const maxDrawdownPct = rows.reduce((max, row) => Math.min(max, row.profitPct ?? 0), 0);
  const missedWinners = rows.filter((row) => row.verdict === "MISSED_OPPORTUNITY").length;
  const falseRejects = rows.filter((row) => row.verdict === "MISSED_OPPORTUNITY" || row.verdict === "FALSE_ENTRY").length;
  const falseEntries = rows.filter((row) => row.verdict === "FALSE_ENTRY").length;
  const correct = rows.filter((row) => row.verdict === "CORRECT" || row.verdict === "BETTER").length;
  const replayAccuracy = rows.length > 0 ? (correct / rows.length) * 100 : 0;
  const rejectRows = rows.filter((row) => row.decision === "NO_TRADE" || row.decision === "HOLD");
  const rejectCorrect = rejectRows.filter((row) => row.verdict === "CORRECT" || row.verdict === "BETTER").length;
  const rejectAccuracy = rejectRows.length > 0 ? (rejectCorrect / rejectRows.length) * 100 : undefined;

  const decisions = await prisma.decisionDifference.findMany({
    where: {
      shadowEngineId: input.engineId,
      createdAt: { gte: input.periodStart, lte: input.periodEnd },
    },
    take: 2000,
  });
  const stable = decisions.filter((row) => (row.disagreements as string[] | null)?.length === 0).length;
  const decisionStability = decisions.length > 0 ? (stable / decisions.length) * 100 : undefined;

  const periodDays = Math.max(1, (input.periodEnd.getTime() - input.periodStart.getTime()) / (24 * 60 * 60 * 1000));
  const tradeFrequency = rows.length / periodDays;
  const sharpeRatio = sharpe(returns);
  const sortinoRatio = sortino(returns);
  const calmarRatio = maxDrawdownPct < 0 ? expectancy / Math.abs(maxDrawdownPct) : expectancy;

  return {
    engineId: input.engineId,
    winRate,
    lossRate,
    profitFactor,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdownPct: Math.abs(maxDrawdownPct),
    avgProfitPct,
    avgLossPct,
    avgHoldingMin: 60,
    expectancy,
    avgRiskReward: grossLoss > 0 ? grossProfit / grossLoss : 0,
    tradeFrequency,
    missedWinners,
    falseRejects,
    falseEntries,
    completedTrades: rows.length,
    rejectAccuracy,
    decisionStability,
    replayAccuracy,
  };
}

export async function persistEngineScorecard(input: {
  scorecard: EngineScorecard;
  periodStart: Date;
  periodEnd: Date;
  cadence: ValidationReportCadence;
}) {
  const { scorecard } = input;
  return prisma.enginePerformance.create({
    data: {
      engineId: scorecard.engineId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      cadence: input.cadence,
      winRate: scorecard.winRate,
      lossRate: scorecard.lossRate,
      profitFactor: scorecard.profitFactor,
      sharpeRatio: scorecard.sharpeRatio,
      sortinoRatio: scorecard.sortinoRatio,
      calmarRatio: scorecard.calmarRatio,
      maxDrawdownPct: scorecard.maxDrawdownPct,
      avgProfitPct: scorecard.avgProfitPct,
      avgLossPct: scorecard.avgLossPct,
      avgHoldingMin: scorecard.avgHoldingMin,
      expectancy: scorecard.expectancy,
      avgRiskReward: scorecard.avgRiskReward,
      tradeFrequency: scorecard.tradeFrequency,
      missedWinners: scorecard.missedWinners,
      falseRejects: scorecard.falseRejects,
      falseEntries: scorecard.falseEntries,
      completedTrades: scorecard.completedTrades,
      rejectAccuracy: scorecard.rejectAccuracy,
      decisionStability: scorecard.decisionStability,
      replayAccuracy: scorecard.replayAccuracy,
      scorecard: scorecard as never,
    },
  });
}
