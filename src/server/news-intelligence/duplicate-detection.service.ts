import { prisma } from "@/src/server/db/prisma";
import { markDuplicate } from "@/src/server/news-intelligence/news-intelligence.repository";
import { hashContent } from "@/src/server/news-intelligence/news-intelligence.repository";
import { emitNewsEvent, NEWS_EVENT } from "@/src/server/news-intelligence/news-intelligence.events";

export async function detectDuplicates(limit = 100) {
  const articles = await prisma.newsArticle.findMany({
    where: { isDuplicate: false, status: { not: "DUPLICATE" } },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });

  const byHash = new Map<string, string>();
  let merged = 0;

  for (const article of articles) {
    const hash = article.contentHash ?? hashContent(article.title, article.content ?? undefined);
    const canonical = byHash.get(hash);
    if (canonical) {
      await markDuplicate(article.id, canonical);
      merged += 1;
      emitNewsEvent(NEWS_EVENT.DUPLICATE_MERGED, { articleId: article.id, canonicalId: canonical });
      continue;
    }
    byHash.set(hash, article.id);

    const similar = await findSimilarTitle(article.title, article.id);
    if (similar) {
      await markDuplicate(article.id, similar);
      merged += 1;
    }
  }

  return { checked: articles.length, merged };
}

async function findSimilarTitle(title: string, excludeId: string) {
  const normalized = title.toLowerCase().replace(/[^a-z0-9\s]/g, "").slice(0, 80);
  const recent = await prisma.newsArticle.findMany({
    where: { id: { not: excludeId }, isDuplicate: false },
    orderBy: { publishedAt: "desc" },
    take: 50,
    select: { id: true, title: true },
  });
  for (const row of recent) {
    const other = row.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").slice(0, 80);
    if (jaccardSimilarity(normalized, other) > 0.75) return row.id;
  }
  return null;
}

function jaccardSimilarity(a: string, b: string) {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}
