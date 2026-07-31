import { prisma } from "@/src/server/db/prisma";
import { persistClassification } from "@/src/server/news-intelligence/news-intelligence.repository";
import { CATEGORY_KEYWORDS } from "@/src/server/news-intelligence/news-intelligence.types";
import { emitNewsEvent, NEWS_EVENT } from "@/src/server/news-intelligence/news-intelligence.events";
import type { NewsCategory } from "@prisma/client";

export async function classifyArticle(articleId: string) {
  const article = await prisma.newsArticle.findUnique({ where: { id: articleId }, include: { source: true } });
  if (!article) return null;

  const text = `${article.title} ${article.content ?? ""}`.toLowerCase();
  let bestCategory: NewsCategory = "GENERAL";
  let bestScore = 0;
  const keywords: string[] = [];

  for (const [category, kws] of Object.entries(CATEGORY_KEYWORDS) as Array<[NewsCategory, string[]]>) {
    let score = 0;
    for (const kw of kws) {
      if (text.includes(kw)) {
        score += 1;
        keywords.push(kw);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (text.includes("giveaway") || text.includes("100x")) bestCategory = "SPAM";
  if (text.includes("rumor") || text.includes("unconfirmed")) bestCategory = "RUMOR";

  const confidence = Math.min(100, bestScore * 25 + 20);
  const row = await persistClassification({
    articleId,
    category: bestCategory,
    confidence,
    keywords: [...new Set(keywords)],
  });
  emitNewsEvent(NEWS_EVENT.ARTICLE_CLASSIFIED, { articleId, category: bestCategory, confidence });
  return row;
}

export async function classifyRecentArticles(limit = 50) {
  const rows = await prisma.newsArticle.findMany({
    where: { status: "INGESTED" },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  let classified = 0;
  for (const row of rows) {
    await classifyArticle(row.id).catch(() => null);
    classified += 1;
  }
  return { classified };
}
