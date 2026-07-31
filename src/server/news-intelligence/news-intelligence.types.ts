import type { NarrativeType, NewsCategory, NewsIntelligenceJobType, NewsSentiment, NewsSourceType } from "@prisma/client";

export type NewsIntelligenceJobPayload =
  | { type: "NEWS_COLLECT"; limit?: number }
  | { type: "RSS_COLLECT"; limit?: number }
  | { type: "TWITTER_COLLECT"; limit?: number }
  | { type: "TELEGRAM_COLLECT"; limit?: number }
  | { type: "GITHUB_COLLECT"; limit?: number }
  | { type: "CLASSIFY"; articleId?: string; limit?: number }
  | { type: "NARRATIVE_DETECT"; limit?: number }
  | { type: "IMPACT_SCORE"; articleId?: string; limit?: number }
  | { type: "DUPLICATE_DETECT"; limit?: number }
  | { type: "SENTIMENT_ANALYZE"; articleId?: string; limit?: number }
  | { type: "COIN_MAP"; articleId?: string; limit?: number }
  | { type: "REPLAY_ANALYZE"; articleId?: string; limit?: number }
  | { type: "NEWS_LEARN"; limit?: number }
  | { type: "TIMELINE_SYNC"; articleId?: string }
  | { type: "SOURCE_SCORE"; sourceId?: string };

export type IngestedArticle = {
  title: string;
  content?: string;
  url?: string;
  publishedAt: Date;
  isBreaking?: boolean;
  language?: string;
  rawPayload?: Record<string, unknown>;
};

export type ImpactScoreResult = {
  impactScore: number;
  importance: number;
  urgency: number;
  credibility: number;
  historicalImpact: number;
  marketSensitivity: number;
  expectedVolatility: number;
  confidence: number;
  sentiment: NewsSentiment;
};

export const DEFAULT_SOURCES: Array<{ sourceKey: string; name: string; sourceType: NewsSourceType; exchange?: string; url?: string }> = [
  { sourceKey: "binance_announcements", name: "Binance Announcements", sourceType: "EXCHANGE", exchange: "BINANCE", url: "https://www.binance.com/en/support/announcement" },
  { sourceKey: "bybit_announcements", name: "Bybit Announcements", sourceType: "EXCHANGE", exchange: "BYBIT" },
  { sourceKey: "okx_announcements", name: "OKX Announcements", sourceType: "EXCHANGE", exchange: "OKX" },
  { sourceKey: "mexc_announcements", name: "MEXC Announcements", sourceType: "EXCHANGE", exchange: "MEXC" },
  { sourceKey: "gate_announcements", name: "Gate Announcements", sourceType: "EXCHANGE", exchange: "GATE" },
  { sourceKey: "coinmarketcap", name: "CoinMarketCap", sourceType: "AGGREGATOR", url: "https://coinmarketcap.com" },
  { sourceKey: "coingecko", name: "CoinGecko", sourceType: "AGGREGATOR", url: "https://coingecko.com" },
  { sourceKey: "twitter_crypto", name: "X (Twitter) Crypto", sourceType: "SOCIAL" },
  { sourceKey: "telegram_crypto", name: "Telegram Crypto", sourceType: "TELEGRAM" },
  { sourceKey: "github_releases", name: "GitHub Releases", sourceType: "GITHUB" },
  { sourceKey: "economic_calendar", name: "Economic Calendar", sourceType: "CALENDAR" },
  { sourceKey: "etf_news", name: "ETF News", sourceType: "ETF" },
  { sourceKey: "sec_filings", name: "SEC Filings", sourceType: "GOVERNMENT" },
  { sourceKey: "medium_crypto", name: "Medium Crypto", sourceType: "MEDIUM" },
  { sourceKey: "project_blogs", name: "Official Project Blogs", sourceType: "BLOG" },
];

export const CATEGORY_KEYWORDS: Record<NewsCategory, string[]> = {
  LISTING: ["list", "listing", "will list", "adds trading"],
  DELISTING: ["delist", "remove", "suspend trading"],
  PARTNERSHIP: ["partner", "collaboration", "integrat"],
  HACK: ["hack", "breach", "stolen", "exploit"],
  EXPLOIT: ["exploit", "vulnerability", "drained"],
  UPGRADE: ["upgrade", "hard fork", "network upgrade"],
  MAINNET: ["mainnet", "main net launch"],
  TESTNET: ["testnet", "test net"],
  TOKEN_UNLOCK: ["unlock", "vesting", "cliff"],
  BURN: ["burn", "token burn"],
  STAKING: ["staking", "stake"],
  ETF: ["etf", "spot etf", "fund"],
  SEC: ["sec", "securities and exchange"],
  REGULATION: ["regulation", "regulatory", "ban", "legal"],
  MACRO: ["macro", "economy", "gdp", "recession"],
  INTEREST_RATE: ["interest rate", "fed", "fomc", "rate hike", "rate cut"],
  INFLATION: ["inflation", "cpi", "ppi"],
  WAR: ["war", "conflict", "sanction", "geopolit"],
  EXCHANGE_ISSUE: ["maintenance", "outage", "withdrawal suspend"],
  LIQUIDITY_EVENT: ["liquidity", "insolvency", "bankruptcy"],
  WHALE_TRANSFER: ["whale", "large transfer", "moved"],
  AIRDROP: ["airdrop", "drop"],
  GENERAL: [],
  RUMOR: ["rumor", "unconfirmed", "alleged"],
  SPAM: ["giveaway", "free crypto", "100x guaranteed"],
};

export const NARRATIVE_KEYWORDS: Record<NarrativeType, string[]> = {
  AI: ["ai", "artificial intelligence", "machine learning", "agent"],
  RWA: ["rwa", "real world asset", "tokenized"],
  MEME: ["meme", "doge", "pepe", "shib"],
  GAMING: ["game", "gaming", "play to earn"],
  LAYER1: ["layer 1", "l1", "blockchain"],
  LAYER2: ["layer 2", "l2", "rollup"],
  DEPIN: ["depin", "decentralized physical"],
  INFRASTRUCTURE: ["infra", "oracle", "bridge", "indexer"],
  PRIVACY: ["privacy", "zk", "zero knowledge"],
  STABLECOINS: ["stablecoin", "usdt", "usdc", "depeg"],
  PAYMENTS: ["payment", "remittance", "visa", "mastercard"],
  BITCOIN_ECOSYSTEM: ["bitcoin", "btc", "ordinals", "brc"],
  ETHEREUM_ECOSYSTEM: ["ethereum", "eth", "erc"],
  SOLANA_ECOSYSTEM: ["solana", "sol", "spl"],
  OTHER: [],
};

export const NEWS_EVENT = {
  ARTICLE_INGESTED: "NewsArticleIngested",
  ARTICLE_CLASSIFIED: "NewsArticleClassified",
  IMPACT_SCORED: "NewsImpactScored",
  NARRATIVE_UPDATED: "NarrativeUpdated",
  DUPLICATE_MERGED: "DuplicateMerged",
  REPLAY_COMPLETED: "NewsReplayCompleted",
} as const;

export type { NarrativeType, NewsCategory, NewsIntelligenceJobType, NewsSentiment, NewsSourceType };
