import { generateWeightRecommendations } from "@/src/server/replay/weight-recommendation.service";
import { persistWeightSuggestion } from "@/src/server/learning-engine/learning-engine.repository";
import { prisma } from "@/src/server/db/prisma";

export async function generateLearningWeightSuggestions() {
  await generateWeightRecommendations();
  const replayRows = await prisma.weightRecommendation.findMany({ orderBy: { computedAt: "desc" }, take: 50 });
  let stored = 0;
  for (const row of replayRows) {
    await persistWeightSuggestion({
      feature: row.filterName,
      currentWeight: Number(row.currentWeight ?? 0.5),
      suggestedWeight: Number(row.suggestedWeight ?? row.currentWeight ?? 0.5),
      // More proposed trades is not a measured improvement in winning probability.
      expectedWinRateDelta: undefined,
      expectedProfitFactorDelta: Number(row.expectedProfitFactorDelta ?? 0),
      confidence: Number(row.confidence ?? 0.5) * 100,
      rationale: row.rationale ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
    });
    stored += 1;
  }

  const expertRows = await prisma.expertRecommendation.findMany({ orderBy: { computedAt: "desc" }, take: 20 });
  for (const row of expertRows) {
    await persistWeightSuggestion({
      feature: `${row.expertType}_weight`,
      currentWeight: Number(row.currentWeight ?? 0),
      suggestedWeight: Number(row.recommendedWeight ?? row.currentWeight ?? 0),
      expectedWinRateDelta: 0,
      expectedProfitFactorDelta: 0,
      confidence: Number(row.confidence ?? 0) * 100,
      rationale: row.rationale ?? undefined,
    });
    stored += 1;
  }

  return { stored };
}
