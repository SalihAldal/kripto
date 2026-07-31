import { prisma } from "@/src/server/db/prisma";
import { persistResearchKnowledge } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";

export async function runFeatureSelection(windowDays = 90) {
  return researchDbOnly(async () => {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const features = await prisma.learningFeature.findMany({
      where: { createdAt: { gte: since } },
      take: 5000,
      include: { learningTrade: { select: { outcome: true, returnPercent: true } } },
    });

    const aggregates = new Map<string, { wins: number; total: number; returnSum: number }>();
    for (const row of features) {
      const key = row.featureKey;
      const bucket = aggregates.get(key) ?? { wins: 0, total: 0, returnSum: 0 };
      bucket.total += 1;
      if (row.learningTrade.outcome === "WIN") bucket.wins += 1;
      bucket.returnSum += Number(row.learningTrade.returnPercent ?? 0);
      aggregates.set(key, bucket);
    }

    const ranked = [...aggregates.entries()]
      .filter(([, b]) => b.total >= 5)
      .map(([feature, bucket]) => ({
        feature,
        winRate: (bucket.wins / bucket.total) * 100,
        avgReturn: bucket.returnSum / bucket.total,
        sampleSize: bucket.total,
        value: (bucket.wins / bucket.total) * bucket.returnSum,
      }))
      .sort((a, b) => b.value - a.value);

    const valuable = ranked.filter((r) => r.winRate >= 50 && r.avgReturn > 0).slice(0, 15);
    const harmful = ranked.filter((r) => r.winRate < 45 || r.avgReturn < 0).slice(0, 15);

    await persistResearchKnowledge({
      category: "FEATURE_SELECTION",
      title: `Feature selection ${windowDays}d`,
      content: JSON.stringify({ valuable, harmful }),
      tags: ["feature-selection", `${windowDays}d`],
    }).catch(() => null);

    return { valuable, harmful, totalFeatures: ranked.length };
  });
}
