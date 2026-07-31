import { prisma } from "@/src/server/db/prisma";

export async function generateWeightRecommendations() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const rejectStats = await prisma.rejectAccuracy.findMany({
    where: { computedAt: { gte: since } },
    orderBy: { computedAt: "desc" },
    take: 200,
  });

  const recommendations = [];

  for (const stat of rejectStats) {
    const wrongPct = Number(stat.wrongPct ?? 0);
    const avgMissed = Number(stat.avgMissedProfitPct ?? 0);
    if (stat.totalRejects < 10) continue;

    const currentWeight = categoryDefaultWeight(stat.rejectCategory);
    const suggestedWeight = Math.max(
      0.2,
      Number((currentWeight - wrongPct / 200 - avgMissed / 100).toFixed(2)),
    );

    if (Math.abs(currentWeight - suggestedWeight) < 0.05) continue;

    recommendations.push({
      filterName: `${stat.rejectCategory}_filter`,
      rejectCategory: stat.rejectCategory,
      currentWeight,
      suggestedWeight,
      currentThreshold: categoryDefaultThreshold(stat.rejectCategory),
      suggestedThreshold: Math.max(
        0,
        Number((categoryDefaultThreshold(stat.rejectCategory) - wrongPct / 10).toFixed(2)),
      ),
      expectedProfitFactorDelta: Number((avgMissed / 50).toFixed(3)),
      expectedTradeIncreasePct: Number((wrongPct / 5).toFixed(2)),
      sampleSize: stat.totalRejects,
      confidence: Math.min(0.95, stat.totalRejects / 100),
      rationale: `${stat.rejectCategory} reject wrong=${wrongPct.toFixed(1)}% avgMissed=${avgMissed.toFixed(2)}% over ${stat.totalRejects} samples`,
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
    });
  }

  const confidenceStats = await prisma.decisionAccuracy.findMany({
    where: { dimension: "decision", computedAt: { gte: since } },
    orderBy: { computedAt: "desc" },
    take: 20,
  });
  const rejectDecision = confidenceStats.find((row) => row.dimensionKey === "NO_TRADE" || row.dimensionKey === "REJECT");
  if (rejectDecision && rejectDecision.totalDecisions >= 20) {
    recommendations.push({
      filterName: "confidence_threshold",
      rejectCategory: "confidence",
      currentWeight: null,
      suggestedWeight: null,
      currentThreshold: 82,
      suggestedThreshold: Math.max(60, Math.round(82 - Number(rejectDecision.avgMissedProfitPct ?? 0))),
      expectedProfitFactorDelta: Number(((rejectDecision.avgMissedProfitPct ?? 0) / 40).toFixed(3)),
      expectedTradeIncreasePct: Number((Number(rejectDecision.wrongCount) / Math.max(rejectDecision.totalDecisions, 1) * 100).toFixed(2)),
      sampleSize: rejectDecision.totalDecisions,
      confidence: 0.7,
      rationale: "Confidence threshold recommendation from rejected decision accuracy",
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
    });
  }

  if (recommendations.length === 0) return 0;

  await prisma.weightRecommendation.deleteMany({ where: { computedAt: { lt: since } } });
  await prisma.weightRecommendation.createMany({ data: recommendations });
  return recommendations.length;
}

function categoryDefaultWeight(category: string) {
  const map: Record<string, number> = {
    liquidity: 0.8,
    momentum: 0.75,
    news: 0.65,
    regime: 0.75,
    risk: 0.9,
    quality: 0.82,
    trend: 0.7,
    data_quality: 0.88,
    policy: 0.78,
    general: 0.5,
  };
  return map[category] ?? 0.6;
}

function categoryDefaultThreshold(category: string) {
  const map: Record<string, number> = {
    liquidity: 70,
    momentum: 65,
    news: 60,
    confidence: 82,
    quality: 75,
  };
  return map[category] ?? 70;
}
