import type { NewsSentiment } from "@prisma/client";

const POSITIVE = ["surge", "approve", "partnership", "launch", "list", "bullish", "gain", "record", "growth"];
const NEGATIVE = ["hack", "exploit", "ban", "crash", "selloff", "bearish", "loss", "drain", "suspend"];
const FEAR = ["panic", "fear", "collapse", "crisis", "bankruptcy", "war"];
const GREED = ["moon", "100x", "pump", "fomo", "all time high", "ath"];
const EXCITEMENT = ["breakout", "surge", "rally", "soar", "partnership"];
const PANIC = ["liquidation", "cascade", "flash crash", "emergency"];

export function analyzeSentiment(text: string) {
  const lower = text.toLowerCase();
  const scores: Record<NewsSentiment, number> = {
    POSITIVE: 0,
    NEUTRAL: 1,
    NEGATIVE: 0,
    FEAR: 0,
    GREED: 0,
    EXCITEMENT: 0,
    PANIC: 0,
  };

  for (const w of POSITIVE) if (lower.includes(w)) scores.POSITIVE += 1;
  for (const w of NEGATIVE) if (lower.includes(w)) scores.NEGATIVE += 1;
  for (const w of FEAR) if (lower.includes(w)) scores.FEAR += 1;
  for (const w of GREED) if (lower.includes(w)) scores.GREED += 1;
  for (const w of EXCITEMENT) if (lower.includes(w)) scores.EXCITEMENT += 1;
  for (const w of PANIC) if (lower.includes(w)) scores.PANIC += 1;

  const sentiment = (Object.entries(scores) as Array<[NewsSentiment, number]>).sort((a, b) => b[1] - a[1])[0]![0];
  const intensity = Math.max(...Object.values(scores));
  return { sentiment, intensity, scores };
}

export async function analyzeRecentSentiment(limit = 50) {
  const { prisma } = await import("@/src/server/db/prisma");
  const articles = await prisma.newsArticle.findMany({ orderBy: { publishedAt: "desc" }, take: limit });
  return articles.map((a) => ({ articleId: a.id, ...analyzeSentiment(`${a.title} ${a.content ?? ""}`) }));
}
