import { getLatestContext } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import type { ConfidenceScores } from "@/src/server/meta-intelligence/meta-intelligence.types";

export async function calibrateConfidence(contextId?: string): Promise<ConfidenceScores & { contextId?: string }> {
  const ctx = contextId
    ? await import("@/src/server/db/prisma").then(({ prisma }) => prisma.metaContext.findUnique({ where: { id: contextId } }))
    : await getLatestContext();

  if (!ctx) {
    return { overallConfidence: 50, dataConfidence: 50, marketConfidence: 50, executionConfidence: 50, portfolioConfidence: 50, modelConfidence: 50 };
  }

  const news = ctx.newsSnapshot as { avgScore?: number } | null;
  const whale = ctx.whaleSnapshot as { avgActivity?: number } | null;
  const eng = ctx.engineeringSnapshot as { overallScore?: number } | null;
  const portfolio = ctx.portfolioSnapshot as { openPositions?: number } | null;

  const scores: ConfidenceScores = {
    dataConfidence: Math.min(100, eng?.overallScore ?? ctx.dataConfidence),
    marketConfidence: Math.min(100, ((news?.avgScore ?? 50) + (whale?.avgActivity ?? 50)) / 2),
    executionConfidence: (portfolio?.openPositions ?? 0) > 15 ? 45 : 72,
    portfolioConfidence: Math.max(20, 100 - (portfolio?.openPositions ?? 0) * 5),
    modelConfidence: 68,
    overallConfidence: 0,
  };

  scores.overallConfidence = Number((
    scores.dataConfidence * 0.15 +
    scores.marketConfidence * 0.25 +
    scores.executionConfidence * 0.2 +
    scores.portfolioConfidence * 0.2 +
    scores.modelConfidence * 0.2
  ).toFixed(1));

  return { ...scores, contextId: ctx.id };
}
