import { prisma } from "@/src/server/db/prisma";
import { appendTimelineEvent } from "@/src/server/news-intelligence/news-intelligence.repository";

export async function syncArticleTimeline(articleId?: string) {
  if (articleId) {
    const events = await prisma.newsTimeline.findMany({
      where: { articleId },
      orderBy: { recordedAt: "asc" },
    });
    return { articleId, events };
  }

  const articles = await prisma.newsArticle.findMany({
    where: { timeline: { none: {} } },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });
  for (const article of articles) {
    await appendTimelineEvent(article.id, "SYNC", "Timeline initialized");
  }
  return { synced: articles.length };
}

export async function getArticleTimeline(articleId: string) {
  return prisma.newsTimeline.findMany({
    where: { articleId },
    orderBy: { recordedAt: "asc" },
  });
}

export async function recordTimelineCorrection(articleId: string, message: string, payload?: Record<string, unknown>) {
  return appendTimelineEvent(articleId, "CORRECTION", message, payload);
}

export async function recordTimelineDeletion(articleId: string, reason?: string) {
  await prisma.newsArticle.update({ where: { id: articleId }, data: { status: "DELETED" } });
  return appendTimelineEvent(articleId, "DELETED", reason ?? "Article removed from feed");
}
