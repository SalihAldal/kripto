type SentimentLabel = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

type SocialSentimentSnapshot = {
  socialSentimentScore: number;
  newsSentiment: SentimentLabel;
  summary: {
    redditMentions: number;
    rssMentions: number;
    totalMentions: number;
  };
};

const cache = new Map<string, { at: number; value: SocialSentimentSnapshot }>();
const CACHE_TTL_MS = 6 * 60_000;
const FETCH_TIMEOUT_MS = 6_000;

const POSITIVE_WORDS = [
  "bull",
  "bullish",
  "breakout",
  "pump",
  "moon",
  "rally",
  "surge",
  "strong",
  "uptrend",
  "buy",
  "long",
  "accumulate",
  "whale",
  "listing",
  "partnership",
  "adoption",
  "upgrade",
];

const NEGATIVE_WORDS = [
  "bear",
  "bearish",
  "dump",
  "crash",
  "rug",
  "rugpull",
  "selloff",
  "sell",
  "short",
  "hack",
  "exploit",
  "lawsuit",
  "ban",
  "delist",
  "scam",
  "panic",
];

const REDDIT_SUBS = [
  "cryptocurrency",
  "cryptomarkets",
  "binance",
  "altcoin",
  "bitcoin",
  "ethereum",
  "defi",
  "cryptomoonshots",
];
const RSS_FEEDS = [
  "https://cointelegraph.com/rss",
  "https://www.coindesk.com/arc/outboundfeeds/rss/",
  "https://decrypt.co/feed",
  "https://news.bitcoin.com/feed/",
  "https://www.binance.com/en/support/announcement/rss",
  "https://blog.kraken.com/rss",
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function scoreText(text: string) {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const word of POSITIVE_WORDS) {
    if (normalized.includes(word)) score += 1;
  }
  for (const word of NEGATIVE_WORDS) {
    if (normalized.includes(word)) score -= 1;
  }
  return score;
}

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/xml,application/rss+xml",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} @ ${url}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractSymbolTokens(symbol: string) {
  const normalized = symbol.toUpperCase();
  const quoteSuffixes = ["TRY", "USDT", "USDC", "BUSD", "BTC", "ETH"];
  const quote = quoteSuffixes.find((q) => normalized.endsWith(q));
  const base = quote ? normalized.slice(0, -quote.length) : normalized;
  const tokens = new Set<string>();
  if (base.length >= 2) tokens.add(base);
  return Array.from(tokens);
}

function extractRssTitles(payload: string) {
  const titles: string[] = [];
  const regex = /<title>(<!\[CDATA\[)?([^<]*?)(\]\]>)?<\/title>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(payload)) !== null) {
    const raw = String(match[2] ?? "").trim();
    if (raw && !raw.toLowerCase().includes("rss")) titles.push(raw);
  }
  return titles;
}

function computeSentimentScore(totalScore: number, mentions: number) {
  if (mentions <= 0) return 50;
  const ratio = totalScore / Math.max(mentions, 1);
  return clamp(50 + ratio * 18, 0, 100);
}

function resolveNewsSentiment(score: number): SentimentLabel {
  if (score >= 65) return "POSITIVE";
  if (score <= 35) return "NEGATIVE";
  return "NEUTRAL";
}

export async function getSocialSentimentSnapshot(symbol: string): Promise<SocialSentimentSnapshot> {
  const key = symbol.toUpperCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const tokens = extractSymbolTokens(key);
  if (tokens.length === 0) {
    const fallback = {
      socialSentimentScore: 50,
      newsSentiment: "NEUTRAL" as const,
      summary: { redditMentions: 0, rssMentions: 0, totalMentions: 0 },
    };
    cache.set(key, { at: Date.now(), value: fallback });
    return fallback;
  }

  let redditMentions = 0;
  let rssMentions = 0;
  let scoreTotal = 0;

  await Promise.all(
    REDDIT_SUBS.map(async (sub) => {
      try {
        const payload = await fetchWithTimeout(`https://www.reddit.com/r/${sub}/hot.json?limit=25`);
        const json = JSON.parse(payload) as { data?: { children?: Array<{ data?: { title?: string } }> } };
        const posts = json?.data?.children ?? [];
        for (const post of posts) {
          const title = String(post?.data?.title ?? "");
          if (!title) continue;
          const titleUpper = title.toUpperCase();
          if (!tokens.some((token) => titleUpper.includes(token))) continue;
          redditMentions += 1;
          scoreTotal += scoreText(title);
        }
      } catch {
        // ignore
      }
    }),
  );

  await Promise.all(
    RSS_FEEDS.map(async (feed) => {
      try {
        const payload = await fetchWithTimeout(feed);
        const titles = extractRssTitles(payload);
        for (const title of titles) {
          const titleUpper = title.toUpperCase();
          if (!tokens.some((token) => titleUpper.includes(token))) continue;
          rssMentions += 1;
          scoreTotal += scoreText(title);
        }
      } catch {
        // ignore
      }
    }),
  );

  const totalMentions = redditMentions + rssMentions;
  const socialSentimentScore = computeSentimentScore(scoreTotal, totalMentions);
  const newsSentiment = resolveNewsSentiment(socialSentimentScore);

  const snapshot: SocialSentimentSnapshot = {
    socialSentimentScore: Number(socialSentimentScore.toFixed(2)),
    newsSentiment,
    summary: { redditMentions, rssMentions, totalMentions },
  };
  cache.set(key, { at: Date.now(), value: snapshot });
  return snapshot;
}

export async function getSocialSentimentSnapshotSafe(symbol: string): Promise<SocialSentimentSnapshot> {
  try {
    return await getSocialSentimentSnapshot(symbol);
  } catch {
    return {
      socialSentimentScore: 50,
      newsSentiment: "NEUTRAL",
      summary: { redditMentions: 0, rssMentions: 0, totalMentions: 0 },
    };
  }
}
