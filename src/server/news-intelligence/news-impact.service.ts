import { prisma } from "@/src/server/db/prisma";
import { persistImpact } from "@/src/server/news-intelligence/news-intelligence.repository";
import { analyzeSentiment } from "@/src/server/news-intelligence/sentiment-engine.service";
import { mapCoinsFromArticle } from "@/src/server/news-intelligence/coin-mapping.service";
import { emitNewsEvent, NEWS_EVENT } from "@/src/server/news-intelligence/news-intelligence.events";
import type { ImpactScoreResult } from "@/src/server/news-intelligence/news-intelligence.types";
import type { NewsCategory } from "@prisma/client";

const CATEGORY_IMPACT: Partial<Record<NewsCategory, number>> = {
  LISTING: 85,
  DELISTING: 80,
  HACK: 95,
  EXPLOIT: 90,
  ETF: 88,
  SEC: 82,
  REGULATION: 75,
  WHALE_TRANSFER: 70,
  TOKEN_UNLOCK: 65,
  EXCHANGE_ISSUE: 72,
  MACRO: 78,
  INTEREST_RATE: 80,
  WAR: 85,
  AIRDROP: 55,
  SPAM: 5,
  RUMOR: 20,
};

export async function scoreArticleImpact(articleId: string) {
  const article = await prisma.newsArticle.findUnique({
    where: { id: articleId },
    include: { classification: true, source: { include: { scores: { orderBy: { recordedAt: "desc" }, take: 1 } } } },
  });
  if (!article) return null;

  const category = article.classification?.category ?? "GENERAL";
  const baseImpact = CATEGORY_IMPACT[category] ?? 40;
  const sourceTrust = article.source.scores[0]?.trustScore ?? 50;
  const sentiment = analyzeSentiment(`${article.title} ${article.content ?? ""}`);
  const mapping = mapCoinsFromArticle(article.title, article.content ?? undefined, article.source.exchange ?? undefined);

  const importance = Math.min(100, baseImpact * 0.6 + sourceTrust * 0.2);
  const urgency = article.isBreaking ? 90 : Math.min(100, baseImpact * 0.8);
  const credibility = Math.min(100, sourceTrust * 0.7 + (article.classification?.confidence ?? 50) * 0.3);
  const historicalImpact = await estimateHistoricalImpact(category);
  const marketSensitivity = Math.min(100, mapping.affectedCoins.length * 15 + baseImpact * 0.3);
  const expectedVolatility = Math.min(100, baseImpact * 0.5 + (sentiment.sentiment === "PANIC" || sentiment.sentiment === "FEAR" ? 20 : 0));
  const confidence = Math.min(100, credibility * 0.5 + (article.classification?.confidence ?? 50) * 0.5);
  const impactScore = Math.min(100, (importance + urgency + credibility + historicalImpact + marketSensitivity) / 5);

  const score: ImpactScoreResult = {
    impactScore: Number(impactScore.toFixed(1)),
    importance: Number(importance.toFixed(1)),
    urgency: Number(urgency.toFixed(1)),
    credibility: Number(credibility.toFixed(1)),
    historicalImpact: Number(historicalImpact.toFixed(1)),
    marketSensitivity: Number(marketSensitivity.toFixed(1)),
    expectedVolatility: Number(expectedVolatility.toFixed(1)),
    confidence: Number(confidence.toFixed(1)),
    sentiment: sentiment.sentiment,
  };

  const row = await persistImpact({
    articleId,
    score,
    affectedCoins: mapping.affectedCoins,
    affectedEcosystems: mapping.affectedEcosystems,
    affectedSectors: mapping.affectedSectors,
    affectedExchanges: mapping.affectedExchanges,
    narratives: mapping.narratives,
  });
  emitNewsEvent(NEWS_EVENT.IMPACT_SCORED, { articleId, impactScore: score.impactScore });
  return row;
}

async function estimateHistoricalImpact(category: NewsCategory) {
  const replays = await prisma.newsReplay.findMany({
    where: { article: { classification: { category } } },
    take: 20,
    select: { maxMovePct: true },
  });
  if (replays.length === 0) return CATEGORY_IMPACT[category] ?? 40;
  const avg = replays.reduce((s, r) => s + Math.abs(r.maxMovePct ?? 0), 0) / replays.length;
  return Math.min(100, avg * 10);
}

export async function scoreRecentArticles(limit = 50) {
  const rows = await prisma.newsArticle.findMany({
    where: { status: { in: ["CLASSIFIED", "INGESTED"] } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: { id: true },
  });
  let scored = 0;
  for (const row of rows) {
    await scoreArticleImpact(row.id).catch(() => null);
    scored += 1;
  }
  return { scored };
}
