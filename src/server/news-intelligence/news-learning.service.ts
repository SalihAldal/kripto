import { prisma } from "@/src/server/db/prisma";

export async function learnFromNewsHistory(limit = 200) {
  const impacts = await prisma.newsImpact.findMany({
    orderBy: { scoredAt: "desc" },
    take: limit,
    include: { article: { include: { replays: true, classification: true, source: true } } },
  });

  const moved: Array<{ category: string; avgMove: number; count: number }> = [];
  const zeroImpact: Array<{ category: string; count: number }> = [];
  const narrativePerf = new Map<string, { moves: number[]; count: number }>();
  const sourcePerf = new Map<string, { trust: number[]; count: number }>();

  const byCategory = new Map<string, number[]>();
  for (const impact of impacts) {
    const cat = impact.article.classification?.category ?? "GENERAL";
    const maxMove = impact.article.replays.reduce((s, r) => s + Math.abs(r.maxMovePct ?? 0), 0);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(maxMove);

    for (const narrative of impact.narratives) {
      const bucket = narrativePerf.get(narrative) ?? { moves: [], count: 0 };
      bucket.moves.push(maxMove);
      bucket.count += 1;
      narrativePerf.set(narrative, bucket);
    }

    const sourceKey = impact.article.source.sourceKey;
    const bucket = sourcePerf.get(sourceKey) ?? { trust: [], count: 0 };
    bucket.trust.push(impact.credibility);
    bucket.count += 1;
    sourcePerf.set(sourceKey, bucket);
  }

  for (const [category, moves] of byCategory.entries()) {
    const avg = moves.reduce((s, m) => s + m, 0) / moves.length;
    if (avg >= 2) moved.push({ category, avgMove: avg, count: moves.length });
    else zeroImpact.push({ category, count: moves.length });
  }

  const topNarratives = [...narrativePerf.entries()]
    .map(([narrative, b]) => ({ narrative, avgMove: b.moves.reduce((s, m) => s + m, 0) / Math.max(1, b.moves.length), count: b.count }))
    .sort((a, b) => b.avgMove - a.avgMove)
    .slice(0, 10);

  const topSources = [...sourcePerf.entries()]
    .map(([source, b]) => ({ source, avgTrust: b.trust.reduce((s, t) => s + t, 0) / Math.max(1, b.trust.length), count: b.count }))
    .sort((a, b) => b.avgTrust - a.avgTrust)
    .slice(0, 10);

  return {
    movedCategories: moved.sort((a, b) => b.avgMove - a.avgMove),
    zeroImpactCategories: zeroImpact,
    topNarratives,
    topSources,
    sampleSize: impacts.length,
  };
}
