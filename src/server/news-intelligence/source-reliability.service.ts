import { prisma } from "@/src/server/db/prisma";
import { persistSourceScore } from "@/src/server/news-intelligence/news-intelligence.repository";

export async function scoreSourceReliability(sourceId?: string) {
  const sources = sourceId
    ? [await prisma.newsSource.findUnique({ where: { id: sourceId } })].filter(Boolean)
    : await prisma.newsSource.findMany({ where: { active: true } });

  const results = [];
  for (const source of sources) {
    if (!source) continue;
    const articles = await prisma.newsArticle.findMany({
      where: { sourceId: source.id },
      take: 100,
      include: { impact: true, replays: true },
    });

    const withImpact = articles.filter((a) => a.impact);
    const avgImpact = withImpact.length > 0 ? withImpact.reduce((s, a) => s + (a.impact?.impactScore ?? 0), 0) / withImpact.length : 50;
    const replays = articles.flatMap((a) => a.replays);
    const avgMove = replays.length > 0 ? replays.reduce((s, r) => s + Math.abs(r.maxMovePct ?? 0), 0) / replays.length : 0;
    const falseRate = articles.filter((a) => a.isDuplicate || a.status === "DUPLICATE").length / Math.max(1, articles.length) * 100;
    const accuracy = Math.min(100, avgImpact * 0.6 + avgMove * 5);
    const trustScore = Math.min(100, accuracy * 0.7 + (100 - falseRate) * 0.3);

    const row = await persistSourceScore({
      sourceId: source.id,
      accuracy: Number(accuracy.toFixed(2)),
      historicalPrecision: Number(avgMove.toFixed(2)),
      latencyMs: source.sourceType === "EXCHANGE" ? 500 : source.sourceType === "SOCIAL" ? 2000 : 1500,
      falseNewsRate: Number(falseRate.toFixed(2)),
      trustScore: Number(trustScore.toFixed(2)),
      sampleSize: articles.length,
    });
    results.push({ source: source.sourceKey, score: row });
  }
  return { scored: results.length, results };
}
