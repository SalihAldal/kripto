-- CreateEnum
CREATE TYPE "NewsIntelligenceJobType" AS ENUM ('NEWS_COLLECT', 'RSS_COLLECT', 'TWITTER_COLLECT', 'TELEGRAM_COLLECT', 'GITHUB_COLLECT', 'CLASSIFY', 'NARRATIVE_DETECT', 'IMPACT_SCORE', 'DUPLICATE_DETECT', 'SENTIMENT_ANALYZE', 'COIN_MAP', 'REPLAY_ANALYZE', 'NEWS_LEARN', 'TIMELINE_SYNC', 'SOURCE_SCORE');

-- CreateEnum
CREATE TYPE "NewsSourceType" AS ENUM ('EXCHANGE', 'AGGREGATOR', 'SOCIAL', 'OFFICIAL', 'RSS', 'CALENDAR', 'GOVERNMENT', 'ETF', 'GITHUB', 'TELEGRAM', 'DISCORD', 'MEDIUM', 'BLOG');

-- CreateEnum
CREATE TYPE "NewsCategory" AS ENUM ('LISTING', 'DELISTING', 'PARTNERSHIP', 'HACK', 'EXPLOIT', 'UPGRADE', 'MAINNET', 'TESTNET', 'TOKEN_UNLOCK', 'BURN', 'STAKING', 'ETF', 'SEC', 'REGULATION', 'MACRO', 'INTEREST_RATE', 'INFLATION', 'WAR', 'EXCHANGE_ISSUE', 'LIQUIDITY_EVENT', 'WHALE_TRANSFER', 'AIRDROP', 'GENERAL', 'RUMOR', 'SPAM');

-- CreateEnum
CREATE TYPE "NarrativeType" AS ENUM ('AI', 'RWA', 'MEME', 'GAMING', 'LAYER1', 'LAYER2', 'DEPIN', 'INFRASTRUCTURE', 'PRIVACY', 'STABLECOINS', 'PAYMENTS', 'BITCOIN_ECOSYSTEM', 'ETHEREUM_ECOSYSTEM', 'SOLANA_ECOSYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "NewsSentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'FEAR', 'GREED', 'EXCITEMENT', 'PANIC');

-- CreateEnum
CREATE TYPE "NewsArticleStatus" AS ENUM ('INGESTED', 'CLASSIFIED', 'SCORED', 'DUPLICATE', 'ARCHIVED', 'DELETED');

-- CreateTable
CREATE TABLE "NewsSource" (
    "id" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" "NewsSourceType" NOT NULL,
    "url" TEXT,
    "region" TEXT,
    "exchange" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NewsSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "articleKey" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "url" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "status" "NewsArticleStatus" NOT NULL DEFAULT 'INGESTED',
    "isBreaking" BOOLEAN NOT NULL DEFAULT false,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfId" TEXT,
    "contentHash" TEXT,
    "rawPayload" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsClassification" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "category" "NewsCategory" NOT NULL,
    "subcategory" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "keywords" TEXT[],
    "metadata" JSONB,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsImpact" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "impactScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "urgency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credibility" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "historicalImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marketSensitivity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedVolatility" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sentiment" "NewsSentiment" NOT NULL DEFAULT 'NEUTRAL',
    "affectedCoins" TEXT[],
    "affectedEcosystems" TEXT[],
    "affectedSectors" TEXT[],
    "affectedExchanges" TEXT[],
    "narratives" TEXT[],
    "metadata" JSONB,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsImpact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Narrative" (
    "id" TEXT NOT NULL,
    "narrativeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "narrativeType" "NarrativeType" NOT NULL,
    "heatScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "articleCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Narrative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NarrativeHistory" (
    "id" TEXT NOT NULL,
    "narrativeId" TEXT NOT NULL,
    "heatScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "articleCount" INTEGER NOT NULL DEFAULT 0,
    "topCoins" TEXT[],
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NarrativeHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsReplay" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "priceAtNews" DOUBLE PRECISION,
    "maxMovePct" DOUBLE PRECISION,
    "minMovePct" DOUBLE PRECISION,
    "reactionDelayMs" INTEGER,
    "similarArticleIds" TEXT[],
    "metadata" JSONB,
    "replayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsReplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceScore" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "historicalPrecision" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" DOUBLE PRECISION,
    "falseNewsRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsTimeline" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT,
    "payload" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsTimeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsIntelligenceJobState" (
    "id" TEXT NOT NULL,
    "jobType" "NewsIntelligenceJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsIntelligenceJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsSource_sourceKey_key" ON "NewsSource"("sourceKey");
CREATE INDEX "NewsSource_sourceType_active_idx" ON "NewsSource"("sourceType", "active");
CREATE INDEX "NewsSource_exchange_active_idx" ON "NewsSource"("exchange", "active");
CREATE UNIQUE INDEX "NewsArticle_articleKey_key" ON "NewsArticle"("articleKey");
CREATE INDEX "NewsArticle_sourceId_publishedAt_idx" ON "NewsArticle"("sourceId", "publishedAt");
CREATE INDEX "NewsArticle_status_publishedAt_idx" ON "NewsArticle"("status", "publishedAt");
CREATE INDEX "NewsArticle_isBreaking_publishedAt_idx" ON "NewsArticle"("isBreaking", "publishedAt");
CREATE INDEX "NewsArticle_contentHash_idx" ON "NewsArticle"("contentHash");
CREATE INDEX "NewsArticle_publishedAt_idx" ON "NewsArticle"("publishedAt");
CREATE UNIQUE INDEX "NewsClassification_articleId_key" ON "NewsClassification"("articleId");
CREATE INDEX "NewsClassification_category_classifiedAt_idx" ON "NewsClassification"("category", "classifiedAt");
CREATE UNIQUE INDEX "NewsImpact_articleId_key" ON "NewsImpact"("articleId");
CREATE INDEX "NewsImpact_impactScore_scoredAt_idx" ON "NewsImpact"("impactScore", "scoredAt");
CREATE INDEX "NewsImpact_sentiment_scoredAt_idx" ON "NewsImpact"("sentiment", "scoredAt");
CREATE UNIQUE INDEX "Narrative_narrativeKey_key" ON "Narrative"("narrativeKey");
CREATE INDEX "Narrative_narrativeType_heatScore_idx" ON "Narrative"("narrativeType", "heatScore");
CREATE INDEX "Narrative_heatScore_idx" ON "Narrative"("heatScore");
CREATE INDEX "NarrativeHistory_narrativeId_recordedAt_idx" ON "NarrativeHistory"("narrativeId", "recordedAt");
CREATE INDEX "NewsReplay_articleId_symbol_idx" ON "NewsReplay"("articleId", "symbol");
CREATE INDEX "NewsReplay_symbol_replayedAt_idx" ON "NewsReplay"("symbol", "replayedAt");
CREATE INDEX "SourceScore_sourceId_recordedAt_idx" ON "SourceScore"("sourceId", "recordedAt");
CREATE INDEX "SourceScore_trustScore_idx" ON "SourceScore"("trustScore");
CREATE INDEX "NewsTimeline_articleId_recordedAt_idx" ON "NewsTimeline"("articleId", "recordedAt");
CREATE INDEX "NewsTimeline_eventType_recordedAt_idx" ON "NewsTimeline"("eventType", "recordedAt");
CREATE UNIQUE INDEX "NewsIntelligenceJobState_jobType_key" ON "NewsIntelligenceJobState"("jobType");

-- AddForeignKey
ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsClassification" ADD CONSTRAINT "NewsClassification_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsImpact" ADD CONSTRAINT "NewsImpact_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NarrativeHistory" ADD CONSTRAINT "NarrativeHistory_narrativeId_fkey" FOREIGN KEY ("narrativeId") REFERENCES "Narrative"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsReplay" ADD CONSTRAINT "NewsReplay_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceScore" ADD CONSTRAINT "SourceScore_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "NewsSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NewsTimeline" ADD CONSTRAINT "NewsTimeline_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
