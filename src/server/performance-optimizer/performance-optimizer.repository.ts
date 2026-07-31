import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { PerfOptRecommendationTarget, PerfOptTimelinePeriod } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function persistPerformanceReview(data: Record<string, unknown>) {
  return prisma.perfOptPerformanceReview.create({ data: { reviewKey: key("rev"), ...data } as never });
}

export async function persistTradeQuality(data: Record<string, unknown>) {
  return prisma.perfOptTradeQuality.create({ data: { qualityKey: key("tq"), ...data } as never });
}

export async function persistMissedOpportunity(data: Record<string, unknown>) {
  return prisma.perfOptMissedOpportunity.create({ data: { opportunityKey: key("mo"), ...data } as never });
}

export async function persistEntryOptimization(data: Record<string, unknown>) {
  return prisma.perfOptEntryOptimization.create({ data: { optimizationKey: key("eo"), ...data } as never });
}

export async function persistExitOptimization(data: Record<string, unknown>) {
  return prisma.perfOptExitOptimization.create({ data: { optimizationKey: key("xo"), ...data } as never });
}

export async function persistStrategyPerformanceHistory(data: Record<string, unknown>) {
  return prisma.perfOptStrategyPerformanceHistory.create({ data: { historyKey: key("sph"), ...data } as never });
}

export async function persistCoinPerformance(data: Record<string, unknown>) {
  return prisma.perfOptCoinPerformance.create({ data: { performanceKey: key("cp"), ...data } as never });
}

export async function persistRecommendation(input: {
  target: PerfOptRecommendationTarget;
  title: string;
  description: string;
  expectedBenefit: string;
  confidence: number;
  supportingEvidence?: Record<string, unknown>;
  historicalSuccess?: number;
}) {
  return prisma.perfOptRecommendation.create({
    data: {
      recommendationKey: key("rec"),
      ...input,
      supportingEvidence: input.supportingEvidence as Prisma.InputJsonValue,
    },
  });
}

export async function persistOptimizationHistory(data: Record<string, unknown>) {
  return prisma.perfOptOptimizationHistory.create({ data: { historyKey: key("oh"), ...data } as never });
}

export async function persistTimeline(period: PerfOptTimelinePeriod, periodStart: Date, periodEnd: Date, metrics: Record<string, unknown>, tradeEvolution?: Record<string, unknown>, strategyEvolution?: Record<string, unknown>) {
  return prisma.perfOptTimeline.create({
    data: { timelineKey: key("tl"), period, periodStart, periodEnd, metrics: metrics as Prisma.InputJsonValue, tradeEvolution: tradeEvolution as Prisma.InputJsonValue, strategyEvolution: strategyEvolution as Prisma.InputJsonValue },
  });
}

export async function persistSuccessMetrics(data: Record<string, unknown>) {
  return prisma.perfOptSuccessMetrics.create({ data: { metricsKey: key("sm"), ...data } as never });
}

export async function getPerfOptDashboard() {
  const [reviews, qualities, missed, recommendations, strategyRanks, coinRanks, timeline, successMetrics] = await Promise.all([
    prisma.perfOptPerformanceReview.findMany({ orderBy: { reviewDate: "desc" }, take: 30 }),
    prisma.perfOptTradeQuality.findMany({ orderBy: { scoredAt: "desc" }, take: 50 }),
    prisma.perfOptMissedOpportunity.findMany({ orderBy: { missedProfitPct: "desc" }, take: 30 }),
    prisma.perfOptRecommendation.findMany({ orderBy: { recommendedAt: "desc" }, take: 30 }),
    prisma.perfOptStrategyPerformanceHistory.findMany({ orderBy: { recordedAt: "desc" }, take: 30 }),
    prisma.perfOptCoinPerformance.findMany({ orderBy: { recordedAt: "desc" }, take: 50 }),
    prisma.perfOptTimeline.findMany({ orderBy: { generatedAt: "desc" }, take: 20 }),
    prisma.perfOptSuccessMetrics.findFirst({ orderBy: { calculatedAt: "desc" } }),
  ]);
  const bestTrades = qualities.filter((q) => q.overallScore >= 75).slice(0, 10);
  const worstTrades = qualities.filter((q) => q.overallScore < 40).slice(0, 10);
  return { reviews, qualities, missed, recommendations, strategyRanks, coinRanks, timeline, successMetrics, bestTrades, worstTrades };
}

export async function getDailyReport(date?: Date) {
  const reviewDate = date ?? new Date();
  const start = new Date(reviewDate); start.setHours(0, 0, 0, 0);
  const review = await prisma.perfOptPerformanceReview.findFirst({ where: { reviewDate: start } });
  const qualities = await prisma.perfOptTradeQuality.findMany({ where: { scoredAt: { gte: start } }, orderBy: { overallScore: "desc" } });
  const missed = await prisma.perfOptMissedOpportunity.findMany({ where: { detectedAt: { gte: start } }, orderBy: { missedProfitPct: "desc" } });
  return { review, qualities, missed };
}
