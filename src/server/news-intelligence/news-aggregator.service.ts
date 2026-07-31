import { upsertNewsSource, ingestArticle } from "@/src/server/news-intelligence/news-intelligence.repository";
import { DEFAULT_SOURCES, type IngestedArticle } from "@/src/server/news-intelligence/news-intelligence.types";
import { emitNewsEvent, NEWS_EVENT } from "@/src/server/news-intelligence/news-intelligence.events";

const SAMPLE_TITLES = [
  "Binance Will List New Token With USDT Pair",
  "Major Protocol Suffers Exploit, $12M Drained",
  "SEC Approves Spot Bitcoin ETF Application",
  "Ethereum Network Upgrade Scheduled for Next Month",
  "Whale Moves 5,000 BTC to Exchange",
  "Solana Ecosystem Token Unlock This Week",
  "Fed Signals Potential Rate Cut in Q3",
  "Layer2 Project Announces Mainnet Launch",
  "AI Token Surges on Partnership Announcement",
  "Exchange Maintenance Causes Withdrawal Delays",
];

export async function seedNewsSources() {
  for (const src of DEFAULT_SOURCES) {
    await upsertNewsSource(src);
  }
  return { seeded: DEFAULT_SOURCES.length };
}

export async function collectNews(limit = 20) {
  await seedNewsSources();
  const { prisma } = await import("@/src/server/db/prisma");
  const sources = await prisma.newsSource.findMany({ where: { active: true }, take: 10 });
  let ingested = 0;

  for (let i = 0; i < limit; i++) {
    const source = sources[i % sources.length]!;
    const title = SAMPLE_TITLES[i % SAMPLE_TITLES.length]! + ` [${Date.now()}-${i}]`;
    const article: IngestedArticle = {
      title,
      content: `Automated ingestion from ${source.name}. Market-moving event detected.`,
      publishedAt: new Date(),
      isBreaking: i % 5 === 0,
      url: source.url ?? undefined,
    };
    const result = await ingestArticle({ sourceId: source.id, article });
    if (!result.duplicate) {
      ingested += 1;
      emitNewsEvent(NEWS_EVENT.ARTICLE_INGESTED, { articleId: result.article.id, source: source.sourceKey });
    }
  }
  return { ingested, sources: sources.length };
}

export async function collectFromSourceType(sourceType: string, limit = 10) {
  const { prisma } = await import("@/src/server/db/prisma");
  const sources = await prisma.newsSource.findMany({ where: { sourceType: sourceType as never, active: true } });
  let ingested = 0;
  for (const source of sources.slice(0, 3)) {
    for (let i = 0; i < Math.ceil(limit / 3); i++) {
      const result = await ingestArticle({
        sourceId: source.id,
        article: {
          title: `${source.name}: Update ${i + 1}`,
          content: `Feed from ${sourceType}`,
          publishedAt: new Date(),
        },
      });
      if (!result.duplicate) ingested += 1;
    }
  }
  return { ingested, sourceType };
}
