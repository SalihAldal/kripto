import { prisma } from "@/src/server/db/prisma";
import { researchSeedRecords } from "./research-seed";
import { persistWeeklyResearch } from "@/src/server/learning-engine/learning-engine.repository";

export async function generateWeeklyResearch(weekStartInput = new Date()) {
  const weekStart = startOfWeek(weekStartInput);
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60_000);

  const [trades, patterns, attributions, missed, features] = await Promise.all([
    prisma.learningTrade.findMany({ where: { closedAt: { gte: weekStart, lt: weekEnd } }, take: 500 }),
    prisma.patternLibrary.findMany({ orderBy: { expectancy: "desc" }, take: 20 }),
    prisma.decisionAttribution.findMany({ where: { createdAt: { gte: weekStart, lt: weekEnd } }, take: 100 }),
    prisma.missedOpportunity.findMany({ where: { createdAt: { gte: weekStart, lt: weekEnd } }, take: 100 }),
    prisma.featureImportance.findMany({ orderBy: { importance: "desc" }, take: 20 }),
  ]);

  const content = {
    historicalResearchContext: researchSeedRecords(Math.min(Date.now(), weekEnd.getTime())).map(r => ({ title: r.title, content: r.content, metadata: r.metadata })),
    weekStart: weekStart.toISOString(),
    mostProfitableSetups: patterns.filter((row) => (row.expectancy ?? 0) > 0).slice(0, 10),
    worstSetups: patterns.filter((row) => (row.expectancy ?? 0) < 0).slice(0, 10),
    dangerousFilters: attributions
      .filter((row) => Number(row.contributionWeight ?? 0) < 0)
      .slice(0, 10)
      .map((row) => row.factorName),
    usefulIndicators: features.filter((row) => row.direction === "POSITIVE").slice(0, 10),
    harmfulIndicators: features.filter((row) => row.direction === "NEGATIVE").slice(0, 10),
    strategyRecommendations: buildStrategyRecommendations(trades, patterns),
    marketEvolution: {
      tradeCount: trades.length,
      avgRoe: trades.length > 0 ? trades.reduce((sum, row) => sum + Number(row.returnPercent ?? 0), 0) / trades.length : 0,
      missedCount: missed.length,
    },
  };

  const summary = `Weekly research: ${trades.length} trades, ${patterns.length} patterns tracked, ${missed.length} missed`;
  await persistWeeklyResearch({ weekStart, content, summary });
  return content;
}

function startOfWeek(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function buildStrategyRecommendations(
  trades: Array<{ outcome: string; returnPercent: number | null }>,
  patterns: Array<{ patternKey: string; winRate: number | null; expectancy: number | null }>,
) {
  const winRate = trades.length > 0 ? (trades.filter((row) => row.outcome === "WIN").length / trades.length) * 100 : 0;
  const bestPattern = patterns[0];
  return [
    winRate < 50 ? "Increase selectivity on low-confidence setups" : "Maintain current selectivity",
    bestPattern ? `Focus on pattern ${bestPattern.patternKey} (expectancy ${bestPattern.expectancy?.toFixed(2)})` : "Insufficient pattern data",
    "All recommendations are advisory only — no auto-apply",
  ];
}
