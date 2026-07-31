-- CreateEnum
CREATE TYPE "DiscoveryTier" AS ENUM ('S', 'A', 'B', 'C', 'D');

-- CreateEnum
CREATE TYPE "DiscoveryLaneType" AS ENUM ('MOMENTUM', 'BREAKOUT', 'WHALE', 'VOLUME_EXPLOSION', 'SMART_MONEY', 'TREND', 'RELATIVE_STRENGTH', 'NEWS', 'FUNDING', 'OPEN_INTEREST', 'LIQUIDATION', 'ORDERBOOK', 'LOW_CAP', 'HIGH_VOLUME', 'NEW_LISTING', 'MEME', 'AI_COIN', 'RWA', 'DEPIN', 'ARBITRAGE', 'ANOMALY');

-- CreateEnum
CREATE TYPE "DiscoveryUniverseSource" AS ENUM ('BINANCE_SPOT', 'BINANCE_FUTURES', 'BINANCE_ALPHA', 'BINANCE_LAUNCHPOOL', 'BINANCE_MEGADROP', 'BINANCE_INNOVATION', 'BINANCE_MONITORING', 'NEW_LISTING', 'DELISTING_CANDIDATE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "DiscoveryAssetClass" AS ENUM ('AI', 'LAYER1', 'LAYER2', 'DEFI', 'GAMEFI', 'MEME', 'RWA', 'DEPIN', 'AI_AGENT', 'INFRASTRUCTURE', 'ORACLE', 'PRIVACY', 'PAYMENTS', 'DEX', 'CEX_TOKEN', 'STABLE', 'ETF_RELATED', 'BITCOIN_ECOSYSTEM', 'ETHEREUM_ECOSYSTEM', 'SOLANA_ECOSYSTEM', 'BSC_ECOSYSTEM', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DiscoveryRegime" AS ENUM ('BULL', 'BEAR', 'RANGE', 'PUMP', 'DUMP', 'ACCUMULATION', 'DISTRIBUTION', 'BREAKOUT', 'FAKE_BREAKOUT', 'LOW_VOLATILITY', 'HIGH_VOLATILITY', 'NEWS_RALLY', 'SHORT_SQUEEZE', 'LONG_SQUEEZE', 'LIQUIDITY_TRAP', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OpportunityQueueStatus" AS ENUM ('PENDING', 'CONSUMED', 'EXPIRED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DiscoveryJobType" AS ENUM ('UNIVERSE_SYNC', 'HEALTH_CHECK', 'DISCOVERY_CYCLE', 'LANE_SCAN', 'RANKING', 'LISTING_WATCH');

-- CreateTable
CREATE TABLE "ScannerUniverse" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'binance',
    "marketType" TEXT NOT NULL DEFAULT 'SPOT',
    "quoteAsset" TEXT NOT NULL DEFAULT 'USDT',
    "baseAsset" TEXT,
    "source" "DiscoveryUniverseSource" NOT NULL DEFAULT 'BINANCE_SPOT',
    "status" TEXT NOT NULL DEFAULT 'TRADING',
    "zone" TEXT,
    "isNewListing" BOOLEAN NOT NULL DEFAULT false,
    "isDelistingCandidate" BOOLEAN NOT NULL DEFAULT false,
    "listedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannerUniverse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerHealth" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'binance',
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "rejectReason" TEXT,
    "exchangeOnline" BOOLEAN NOT NULL DEFAULT true,
    "candlesOk" BOOLEAN NOT NULL DEFAULT true,
    "dataQualityScore" DOUBLE PRECISION,
    "metadata" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannerHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerProfile" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" "DiscoveryAssetClass" NOT NULL DEFAULT 'UNKNOWN',
    "regime" "DiscoveryRegime" NOT NULL DEFAULT 'UNKNOWN',
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tier" "DiscoveryTier" NOT NULL DEFAULT 'D',
    "summary" TEXT,
    "positiveFactors" JSONB,
    "negativeFactors" JSONB,
    "tradeTypes" JSONB,
    "profile" JSONB,
    "momentumScore" DOUBLE PRECISION,
    "trendScore" DOUBLE PRECISION,
    "volumeScore" DOUBLE PRECISION,
    "whaleScore" DOUBLE PRECISION,
    "newsScore" DOUBLE PRECISION,
    "liquidityScore" DOUBLE PRECISION,
    "fundingScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "relativeStrengthScore" DOUBLE PRECISION,
    "volatilityScore" DOUBLE PRECISION,
    "breakoutScore" DOUBLE PRECISION,
    "continuationScore" DOUBLE PRECISION,
    "exhaustionScore" DOUBLE PRECISION,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerLane" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "lane" "DiscoveryLaneType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasons" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannerLane_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerScoreDim" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannerScoreDim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerRanking" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "tier" "DiscoveryTier" NOT NULL DEFAULT 'D',
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laneLeader" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannerRanking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerDiscovery" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "tier" "DiscoveryTier" NOT NULL DEFAULT 'D',
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "laneHits" JSONB,
    "metadata" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScannerDiscovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityQueue" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "profileId" TEXT,
    "tier" "DiscoveryTier" NOT NULL DEFAULT 'D',
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "OpportunityQueueStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OpportunityQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryJobState" (
    "id" TEXT NOT NULL,
    "jobType" "DiscoveryJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScannerUniverse_exchange_marketType_symbol_key" ON "ScannerUniverse"("exchange", "marketType", "symbol");

-- CreateIndex
CREATE INDEX "ScannerUniverse_source_status_idx" ON "ScannerUniverse"("source", "status");

-- CreateIndex
CREATE INDEX "ScannerUniverse_isNewListing_syncedAt_idx" ON "ScannerUniverse"("isNewListing", "syncedAt");

-- CreateIndex
CREATE INDEX "ScannerUniverse_symbol_idx" ON "ScannerUniverse"("symbol");

-- CreateIndex
CREATE INDEX "ScannerHealth_symbol_checkedAt_idx" ON "ScannerHealth"("symbol", "checkedAt");

-- CreateIndex
CREATE INDEX "ScannerHealth_healthy_checkedAt_idx" ON "ScannerHealth"("healthy", "checkedAt");

-- CreateIndex
CREATE INDEX "ScannerProfile_symbol_scannedAt_idx" ON "ScannerProfile"("symbol", "scannedAt");

-- CreateIndex
CREATE INDEX "ScannerProfile_tier_opportunityScore_idx" ON "ScannerProfile"("tier", "opportunityScore");

-- CreateIndex
CREATE INDEX "ScannerProfile_scannedAt_idx" ON "ScannerProfile"("scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScannerLane_profileId_lane_key" ON "ScannerLane"("profileId", "lane");

-- CreateIndex
CREATE INDEX "ScannerLane_lane_score_idx" ON "ScannerLane"("lane", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ScannerScoreDim_profileId_dimension_key" ON "ScannerScoreDim"("profileId", "dimension");

-- CreateIndex
CREATE INDEX "ScannerScoreDim_dimension_score_idx" ON "ScannerScoreDim"("dimension", "score");

-- CreateIndex
CREATE INDEX "ScannerRanking_periodEnd_rank_idx" ON "ScannerRanking"("periodEnd", "rank");

-- CreateIndex
CREATE INDEX "ScannerRanking_tier_opportunityScore_idx" ON "ScannerRanking"("tier", "opportunityScore");

-- CreateIndex
CREATE INDEX "ScannerRanking_symbol_periodEnd_idx" ON "ScannerRanking"("symbol", "periodEnd");

-- CreateIndex
CREATE INDEX "ScannerDiscovery_discoveredAt_idx" ON "ScannerDiscovery"("discoveredAt");

-- CreateIndex
CREATE INDEX "ScannerDiscovery_tier_opportunityScore_idx" ON "ScannerDiscovery"("tier", "opportunityScore");

-- CreateIndex
CREATE INDEX "ScannerDiscovery_symbol_discoveredAt_idx" ON "ScannerDiscovery"("symbol", "discoveredAt");

-- CreateIndex
CREATE INDEX "OpportunityQueue_status_priority_opportunityScore_idx" ON "OpportunityQueue"("status", "priority", "opportunityScore");

-- CreateIndex
CREATE INDEX "OpportunityQueue_symbol_createdAt_idx" ON "OpportunityQueue"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "OpportunityQueue_expiresAt_idx" ON "OpportunityQueue"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryJobState_jobType_key" ON "DiscoveryJobState"("jobType");

-- AddForeignKey
ALTER TABLE "ScannerLane" ADD CONSTRAINT "ScannerLane_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScannerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerScoreDim" ADD CONSTRAINT "ScannerScoreDim_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScannerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerRanking" ADD CONSTRAINT "ScannerRanking_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScannerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerDiscovery" ADD CONSTRAINT "ScannerDiscovery_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScannerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityQueue" ADD CONSTRAINT "OpportunityQueue_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ScannerProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
