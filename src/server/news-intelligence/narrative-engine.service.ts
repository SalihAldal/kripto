import { prisma } from "@/src/server/db/prisma";
import { upsertNarrative } from "@/src/server/news-intelligence/news-intelligence.repository";
import { NARRATIVE_KEYWORDS } from "@/src/server/news-intelligence/news-intelligence.types";
import { emitNewsEvent, NEWS_EVENT } from "@/src/server/news-intelligence/news-intelligence.events";
import type { NarrativeType } from "@prisma/client";

export async function detectNarratives(limit = 100) {
  const articles = await prisma.newsArticle.findMany({
    where: { status: { in: ["CLASSIFIED", "SCORED"] } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: { impact: true, classification: true },
  });

  const narrativeCounts = new Map<NarrativeType, { count: number; heat: number; coins: Set<string> }>();
  for (const type of Object.keys(NARRATIVE_KEYWORDS) as NarrativeType[]) {
    narrativeCounts.set(type, { count: 0, heat: 0, coins: new Set() });
  }

  for (const article of articles) {
    const text = `${article.title} ${article.content ?? ""}`.toLowerCase();
    for (const [type, keywords] of Object.entries(NARRATIVE_KEYWORDS) as Array<[NarrativeType, string[]]>) {
      if (keywords.some((kw) => text.includes(kw))) {
        const bucket = narrativeCounts.get(type)!;
        bucket.count += 1;
        bucket.heat += article.impact?.impactScore ?? 10;
        for (const coin of article.impact?.affectedCoins ?? []) bucket.coins.add(coin);
      }
    }
  }

  const updated = [];
  for (const [type, bucket] of narrativeCounts.entries()) {
    if (bucket.count === 0) continue;
    const heatScore = Math.min(100, bucket.heat / bucket.count);
    const row = await upsertNarrative({
      narrativeKey: type.toLowerCase(),
      name: type.replace(/_/g, " "),
      narrativeType: type,
      heatScore,
      articleCount: bucket.count,
      topCoins: [...bucket.coins].slice(0, 10),
    });
    updated.push(row);
    emitNewsEvent(NEWS_EVENT.NARRATIVE_UPDATED, { narrativeKey: type, heatScore });
  }
  return { updated: updated.length, narratives: updated };
}
