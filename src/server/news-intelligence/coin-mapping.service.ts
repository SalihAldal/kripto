import { NARRATIVE_KEYWORDS } from "@/src/server/news-intelligence/news-intelligence.types";
import type { NarrativeType } from "@prisma/client";

const COIN_PATTERNS = [
  /\b(BTC|ETH|SOL|BNB|XRP|ADA|DOGE|AVAX|DOT|MATIC|LINK|UNI|AAVE|ARB|OP|SUI|SEI|TIA|INJ|PEPE|WIF)\b/gi,
  /\b([A-Z]{2,10})(USDT|USDC|BUSD)\b/g,
];

const ECOSYSTEM_MAP: Record<string, string> = {
  BTC: "BITCOIN_ECOSYSTEM",
  ETH: "ETHEREUM_ECOSYSTEM",
  SOL: "SOLANA_ECOSYSTEM",
  ARB: "ETHEREUM_ECOSYSTEM",
  OP: "ETHEREUM_ECOSYSTEM",
};

export function mapCoinsFromArticle(title: string, content?: string, exchange?: string) {
  const text = `${title} ${content ?? ""}`;
  const affectedCoins = new Set<string>();
  for (const pattern of COIN_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const coin = (match[1] ?? match[0]).toUpperCase().replace(/USDT|USDC|BUSD/g, "");
      if (coin.length >= 2 && coin.length <= 10) affectedCoins.add(coin);
    }
  }

  const affectedEcosystems = new Set<string>();
  for (const coin of affectedCoins) {
    const eco = ECOSYSTEM_MAP[coin];
    if (eco) affectedEcosystems.add(eco);
  }

  const affectedSectors = new Set<string>();
  const lower = text.toLowerCase();
  if (lower.includes("defi")) affectedSectors.add("DEFI");
  if (lower.includes("nft")) affectedSectors.add("NFT");
  if (lower.includes("game")) affectedSectors.add("GAMING");

  const affectedExchanges = new Set<string>();
  if (exchange) affectedExchanges.add(exchange);
  if (lower.includes("binance")) affectedExchanges.add("BINANCE");
  if (lower.includes("bybit")) affectedExchanges.add("BYBIT");
  if (lower.includes("okx")) affectedExchanges.add("OKX");

  const narratives: string[] = [];
  for (const [type, keywords] of Object.entries(NARRATIVE_KEYWORDS) as Array<[NarrativeType, string[]]>) {
    if (keywords.some((kw) => lower.includes(kw))) narratives.push(type);
  }

  return {
    affectedCoins: [...affectedCoins],
    affectedEcosystems: [...affectedEcosystems],
    affectedSectors: [...affectedSectors],
    affectedExchanges: [...affectedExchanges],
    narratives,
  };
}

export async function mapRecentArticles(limit = 50) {
  const { prisma } = await import("@/src/server/db/prisma");
  const { persistImpact } = await import("@/src/server/news-intelligence/news-intelligence.repository");
  const articles = await prisma.newsArticle.findMany({
    where: { impact: { isNot: null } },
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: { impact: true, source: true },
  });
  let mapped = 0;
  for (const article of articles) {
    const mapping = mapCoinsFromArticle(article.title, article.content ?? undefined, article.source.exchange ?? undefined);
    if (!article.impact) continue;
    await persistImpact({
      articleId: article.id,
      score: {
        impactScore: article.impact.impactScore,
        importance: article.impact.importance,
        urgency: article.impact.urgency,
        credibility: article.impact.credibility,
        historicalImpact: article.impact.historicalImpact,
        marketSensitivity: article.impact.marketSensitivity,
        expectedVolatility: article.impact.expectedVolatility,
        confidence: article.impact.confidence,
        sentiment: article.impact.sentiment,
      },
      ...mapping,
    }).catch(() => null);
    mapped += 1;
  }
  return { mapped };
}
