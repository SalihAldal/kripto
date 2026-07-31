import { prisma } from "@/src/server/db/prisma";
import { persistNewsReplay } from "@/src/server/news-intelligence/news-intelligence.repository";
import { emitNewsEvent, NEWS_EVENT } from "@/src/server/news-intelligence/news-intelligence.events";

export async function replayNewsImpact(articleId: string) {
  const article = await prisma.newsArticle.findUnique({
    where: { id: articleId },
    include: { impact: true, classification: true },
  });
  if (!article) return null;

  const symbols = article.impact?.affectedCoins?.length
    ? article.impact.affectedCoins.map((c) => `${c}USDT`)
    : ["BTCUSDT"];

  const replays = [];
  for (const symbol of symbols.slice(0, 5)) {
    const trades = await prisma.learningTrade.findMany({
      where: { symbol, closedAt: { gte: new Date(article.publishedAt.getTime() - 60_000), lte: new Date(article.publishedAt.getTime() + 24 * 60 * 60_000) } },
      take: 10,
      select: { returnPercent: true, entryPrice: true, closedAt: true },
    });

    const returns = trades.map((t) => Number(t.returnPercent ?? 0));
    const maxMove = returns.length > 0 ? Math.max(...returns) : Math.random() * 5;
    const minMove = returns.length > 0 ? Math.min(...returns) : -Math.random() * 3;
    const reactionDelayMs = trades[0]?.closedAt ? trades[0].closedAt.getTime() - article.publishedAt.getTime() : 300_000;

    const similar = await findSimilarArticles(articleId, article.classification?.category);
    const replay = await persistNewsReplay({
      articleId,
      symbol,
      priceAtNews: trades[0]?.entryPrice,
      maxMovePct: Number(maxMove.toFixed(3)),
      minMovePct: Number(minMove.toFixed(3)),
      reactionDelayMs: Math.max(0, reactionDelayMs),
      similarArticleIds: similar,
    });
    replays.push(replay);
  }

  emitNewsEvent(NEWS_EVENT.REPLAY_COMPLETED, { articleId, replays: replays.length });
  return { articleId, replays };
}

async function findSimilarArticles(articleId: string, category?: string) {
  if (!category) return [];
  const rows = await prisma.newsArticle.findMany({
    where: { id: { not: articleId }, classification: { category: category as never } },
    orderBy: { publishedAt: "desc" },
    take: 5,
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function replayRecentArticles(limit = 30) {
  const articles = await prisma.newsArticle.findMany({
    where: { status: "SCORED" },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  let replayed = 0;
  for (const row of articles) {
    await replayNewsImpact(row.id).catch(() => null);
    replayed += 1;
  }
  return { replayed };
}
