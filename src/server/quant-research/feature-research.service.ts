import type { FeatureResearchStatus } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistFeatureResearchRows,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";

const FEATURE_CATEGORIES: Record<string, string> = {
  RSI: "MOMENTUM",
  MACD: "MOMENTUM",
  VWAP: "PRICE",
  ATR: "VOLATILITY",
  ADX: "TREND",
  EMA: "TREND",
  BOLLINGER: "VOLATILITY",
  VOLUME: "VOLUME",
  ORDERBOOK: "LIQUIDITY",
  SPREAD: "LIQUIDITY",
  LIQUIDITY: "LIQUIDITY",
  FUNDING: "DERIVATIVES",
  OI: "DERIVATIVES",
};

export async function runFeatureResearch(input?: {
  experimentId?: string;
  windowDays?: number;
}) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const windowDays = input?.windowDays ?? 90;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const run = await createResearchRun({
      projectId: project.id,
      runType: "FEATURE_RESEARCH",
      windowDays,
      metadata: { experimentId: input?.experimentId },
    });

    const features = await prisma.learningFeature.findMany({
      where: { createdAt: { gte: since } },
      take: 8000,
      include: { learningTrade: { select: { outcome: true, returnPercent: true } } },
    });

    const aggregates = new Map<string, { wins: number; total: number; returnSum: number; values: number[] }>();
    for (const row of features) {
      const key = row.featureKey.toUpperCase();
      const bucket = aggregates.get(key) ?? { wins: 0, total: 0, returnSum: 0, values: [] };
      bucket.total += 1;
      const ret = Number(row.learningTrade.returnPercent ?? 0);
      if (row.learningTrade.outcome === "WIN") bucket.wins += 1;
      bucket.returnSum += ret;
      bucket.values.push(Number(row.featureValue ?? 0));
      aggregates.set(key, bucket);
    }

    const ranked = [...aggregates.entries()]
      .filter(([, b]) => b.total >= 5)
      .map(([featureKey, bucket]) => {
        const winRate = (bucket.wins / bucket.total) * 100;
        const avgReturn = bucket.returnSum / bucket.total;
        const importance = (winRate / 100) * Math.abs(avgReturn) * Math.log10(bucket.total + 1);
        return {
          featureKey,
          category: detectCategory(featureKey),
          sampleSize: bucket.total,
          importance: Number(importance.toFixed(4)),
          winRate: Number(winRate.toFixed(3)),
          avgReturn: Number(avgReturn.toFixed(4)),
          correlation: computeSelfCorrelation(bucket.values),
        };
      })
      .sort((a, b) => b.importance - a.importance);

    const rows = await persistFeatureResearchRows(
      input?.experimentId,
      ranked.map((r, i) => ({
        featureKey: r.featureKey,
        category: r.category,
        sampleSize: r.sampleSize,
        importance: r.importance,
        winRate: r.winRate,
        avgReturn: r.avgReturn,
        correlation: r.correlation,
        rank: i + 1,
        status: (r.importance > 1 ? "HIGH_VALUE" : r.importance < 0.1 ? "LOW_VALUE" : "ACTIVE") as FeatureResearchStatus,
      })),
    );

    await completeResearchRun(run.id, `Feature research: ${rows.length} features ranked`);
    return { runId: run.id, ranked: ranked.slice(0, 30), totalFeatures: ranked.length };
  });
}

function detectCategory(featureKey: string): string {
  for (const [prefix, category] of Object.entries(FEATURE_CATEGORIES)) {
    if (featureKey.includes(prefix)) return category;
  }
  return "OTHER";
}

function computeSelfCorrelation(values: number[]): number {
  if (values.length < 3) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Number(Math.sqrt(variance).toFixed(4));
}

export async function getFeatureRanking(limit = 50, experimentId?: string) {
  return researchDbOnly(async () => {
    return prisma.featureResearch.findMany({
      where: experimentId ? { experimentId } : {},
      orderBy: { rank: "asc" },
      take: limit,
    });
  });
}

export async function getFeatureLeaderboard() {
  return researchDbOnly(async () => {
    const highValue = await prisma.featureResearch.findMany({
      where: { status: "HIGH_VALUE" },
      orderBy: { importance: "desc" },
      take: 20,
    });
    const lowValue = await prisma.featureResearch.findMany({
      where: { status: "LOW_VALUE" },
      orderBy: { importance: "asc" },
      take: 20,
    });
    return { highValue, lowValue };
  });
}
