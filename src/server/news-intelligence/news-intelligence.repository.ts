import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { ImpactScoreResult, IngestedArticle } from "@/src/server/news-intelligence/news-intelligence.types";

export function hashContent(title: string, content?: string) {
  return createHash("sha256").update(`${title}|${content ?? ""}`).digest("hex");
}

export async function upsertNewsSource(input: {
  sourceKey: string;
  name: string;
  sourceType: Parameters<typeof prisma.newsSource.create>[0]["data"]["sourceType"];
  url?: string;
  region?: string;
  exchange?: string;
  language?: string;
}) {
  return prisma.newsSource.upsert({
    where: { sourceKey: input.sourceKey },
    create: input,
    update: { name: input.name, url: input.url, active: true },
  });
}

export async function ingestArticle(input: {
  sourceId: string;
  article: IngestedArticle;
}) {
  const contentHash = hashContent(input.article.title, input.article.content);
  const articleKey = `${input.sourceId}_${contentHash.slice(0, 16)}_${input.article.publishedAt.getTime()}`;
  const existing = await prisma.newsArticle.findFirst({ where: { contentHash } });
  if (existing) return { article: existing, duplicate: true };

  const row = await prisma.newsArticle.create({
    data: {
      articleKey,
      sourceId: input.sourceId,
      title: input.article.title,
      content: input.article.content,
      url: input.article.url,
      language: input.article.language ?? "en",
      publishedAt: input.article.publishedAt,
      isBreaking: input.article.isBreaking ?? false,
      contentHash,
      rawPayload: input.article.rawPayload as Prisma.InputJsonValue,
    },
  });
  await appendTimelineEvent(row.id, "INGESTED", "Article ingested");
  return { article: row, duplicate: false };
}

export async function persistClassification(input: {
  articleId: string;
  category: Parameters<typeof prisma.newsClassification.create>[0]["data"]["category"];
  subcategory?: string;
  confidence: number;
  keywords: string[];
}) {
  const row = await prisma.newsClassification.upsert({
    where: { articleId: input.articleId },
    create: input,
    update: { category: input.category, subcategory: input.subcategory, confidence: input.confidence, keywords: input.keywords },
  });
  await prisma.newsArticle.update({ where: { id: input.articleId }, data: { status: "CLASSIFIED" } });
  await appendTimelineEvent(input.articleId, "CLASSIFIED", `Category: ${input.category}`);
  return row;
}

export async function persistImpact(input: {
  articleId: string;
  score: ImpactScoreResult;
  affectedCoins: string[];
  affectedEcosystems: string[];
  affectedSectors: string[];
  affectedExchanges: string[];
  narratives: string[];
}) {
  const row = await prisma.newsImpact.upsert({
    where: { articleId: input.articleId },
    create: {
      articleId: input.articleId,
      ...input.score,
      affectedCoins: input.affectedCoins,
      affectedEcosystems: input.affectedEcosystems,
      affectedSectors: input.affectedSectors,
      affectedExchanges: input.affectedExchanges,
      narratives: input.narratives,
    },
    update: {
      ...input.score,
      affectedCoins: input.affectedCoins,
      affectedEcosystems: input.affectedEcosystems,
      affectedSectors: input.affectedSectors,
      affectedExchanges: input.affectedExchanges,
      narratives: input.narratives,
    },
  });
  await prisma.newsArticle.update({
    where: { id: input.articleId },
    data: { status: "SCORED", isBreaking: input.score.impactScore >= 75 },
  });
  await appendTimelineEvent(input.articleId, "SCORED", `Impact: ${input.score.impactScore}`);
  return row;
}

export async function markDuplicate(articleId: string, duplicateOfId: string) {
  await prisma.newsArticle.update({
    where: { id: articleId },
    data: { isDuplicate: true, duplicateOfId, status: "DUPLICATE" },
  });
  await appendTimelineEvent(articleId, "DUPLICATE", `Merged into ${duplicateOfId}`);
}

export async function persistSourceScore(input: {
  sourceId: string;
  accuracy: number;
  historicalPrecision: number;
  latencyMs?: number;
  falseNewsRate: number;
  trustScore: number;
  sampleSize: number;
}) {
  return prisma.sourceScore.create({ data: input });
}

export async function upsertNarrative(input: {
  narrativeKey: string;
  name: string;
  narrativeType: Parameters<typeof prisma.narrative.create>[0]["data"]["narrativeType"];
  heatScore: number;
  articleCount: number;
  topCoins?: string[];
}) {
  const row = await prisma.narrative.upsert({
    where: { narrativeKey: input.narrativeKey },
    create: {
      narrativeKey: input.narrativeKey,
      name: input.name,
      narrativeType: input.narrativeType,
      heatScore: input.heatScore,
      articleCount: input.articleCount,
    },
    update: { heatScore: input.heatScore, articleCount: input.articleCount },
  });
  await prisma.narrativeHistory.create({
    data: {
      narrativeId: row.id,
      heatScore: input.heatScore,
      articleCount: input.articleCount,
      topCoins: input.topCoins ?? [],
    },
  });
  return row;
}

export async function persistNewsReplay(input: {
  articleId: string;
  symbol: string;
  priceAtNews?: number;
  maxMovePct?: number;
  minMovePct?: number;
  reactionDelayMs?: number;
  similarArticleIds?: string[];
}) {
  return prisma.newsReplay.create({ data: input });
}

export async function appendTimelineEvent(articleId: string, eventType: string, message?: string, payload?: Record<string, unknown>) {
  return prisma.newsTimeline.create({
    data: { articleId, eventType, message, payload: payload as Prisma.InputJsonValue },
  });
}

export async function getNewsDashboard() {
  const [breaking, topImpact, narratives, sources, replays, timeline] = await Promise.all([
    prisma.newsArticle.findMany({ where: { isBreaking: true }, orderBy: { publishedAt: "desc" }, take: 20, include: { impact: true, classification: true, source: true } }),
    prisma.newsImpact.findMany({ orderBy: { impactScore: "desc" }, take: 30, include: { article: { include: { source: true, classification: true } } } }),
    prisma.narrative.findMany({ orderBy: { heatScore: "desc" }, take: 20 }),
    prisma.newsSource.findMany({ where: { active: true }, include: { scores: { orderBy: { recordedAt: "desc" }, take: 1 } } }),
    prisma.newsReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 20, include: { article: true } }),
    prisma.newsTimeline.findMany({ orderBy: { recordedAt: "desc" }, take: 50 }),
  ]);
  return { breaking, topImpact, narratives, sources, replays, timeline };
}

export async function listLatestNews(limit = 50, coin?: string) {
  if (coin) {
    return prisma.newsImpact.findMany({
      where: { affectedCoins: { has: coin.toUpperCase() } },
      orderBy: { scoredAt: "desc" },
      take: limit,
      include: { article: { include: { source: true, classification: true } } },
    });
  }
  return prisma.newsArticle.findMany({
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: { impact: true, classification: true, source: true },
  });
}

export async function listSourceRankings(limit = 30) {
  const sources = await prisma.newsSource.findMany({ where: { active: true }, take: limit });
  const ranked = [];
  for (const source of sources) {
    const score = await prisma.sourceScore.findFirst({ where: { sourceId: source.id }, orderBy: { recordedAt: "desc" } });
    ranked.push({ source, score });
  }
  ranked.sort((a, b) => (b.score?.trustScore ?? 0) - (a.score?.trustScore ?? 0));
  return ranked;
}
