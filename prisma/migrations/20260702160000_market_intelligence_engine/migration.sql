-- CreateEnum
CREATE TYPE "MarketIntelRegime" AS ENUM ('BULL_TREND', 'BEAR_TREND', 'RANGE', 'ACCUMULATION', 'DISTRIBUTION', 'BREAKOUT', 'FAKE_BREAKOUT', 'ROCKET_PUMP', 'PANIC_DUMP', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'NEWS_RALLY', 'MANIPULATION', 'LIQUIDITY_TRAP', 'SHORT_SQUEEZE', 'LONG_SQUEEZE');

-- CreateEnum
CREATE TYPE "MarketIntelJobType" AS ENUM ('CAPTURE_SYMBOL', 'CAPTURE_BATCH', 'VALIDATE_SNAPSHOTS', 'CLEANUP_RETENTION', 'COMPRESS_SNAPSHOTS', 'AGGREGATE_HISTORICAL');

-- AlterEnum
ALTER TYPE "SnapshotInterval" ADD VALUE IF NOT EXISTS 'M3';
ALTER TYPE "SnapshotInterval" ADD VALUE IF NOT EXISTS 'M30';
ALTER TYPE "SnapshotInterval" ADD VALUE IF NOT EXISTS 'H4';
ALTER TYPE "SnapshotInterval" ADD VALUE IF NOT EXISTS 'D1';

-- AlterTable
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "symbol" TEXT;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "open" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "high" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "low" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "close" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "tradeCount" INTEGER;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "vwap" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "atr" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "trueRange" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "spread" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "bidAskRatio" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "orderBookImbalance" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "liquidityScore" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "effectiveLiquidity" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "longShortRatio" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "liquidationVolume" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "whaleActivity" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "whaleBuyVolume" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "whaleSellVolume" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "aggressiveBuyPct" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "aggressiveSellPct" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "netFlow" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "volumeDelta" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "cvd" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "relativeVolume" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "marketCap" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "fdv" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "dominance" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "volatility" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "realizedVolatility" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "impliedVolatility" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "correlationBtc" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "correlationEth" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "relativeStrength" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "regime" "MarketIntelRegime";
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "healthScore" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "dataQualityScore" DOUBLE PRECISION;
ALTER TABLE "MarketSnapshot" ADD COLUMN IF NOT EXISTS "compressedPayload" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MarketSnapshot_symbol_snapshotAt_idx" ON "MarketSnapshot"("symbol", "snapshotAt");
CREATE INDEX IF NOT EXISTS "MarketSnapshot_symbol_interval_snapshotAt_idx" ON "MarketSnapshot"("symbol", "interval", "snapshotAt");
CREATE INDEX IF NOT EXISTS "MarketSnapshot_regime_snapshotAt_idx" ON "MarketSnapshot"("regime", "snapshotAt");
CREATE INDEX IF NOT EXISTS "MarketSnapshot_healthScore_snapshotAt_idx" ON "MarketSnapshot"("healthScore", "snapshotAt");

-- CreateTable MarketTrend, MarketMomentum, etc. (same as schema)
CREATE TABLE IF NOT EXISTS "MarketTrend" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "primaryTrend" TEXT NOT NULL,
    "secondaryTrend" TEXT,
    "microTrend" TEXT,
    "trendStrength" DOUBLE PRECISION,
    "trendAge" INTEGER,
    "trendConfidence" DOUBLE PRECISION,
    "trendExhaustion" DOUBLE PRECISION,
    "trendAcceleration" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketTrend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketTrend_snapshotId_key" ON "MarketTrend"("snapshotId");
CREATE INDEX IF NOT EXISTS "MarketTrend_symbol_createdAt_idx" ON "MarketTrend"("symbol", "createdAt");

CREATE TABLE IF NOT EXISTS "MarketMomentum" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "momentumScore" DOUBLE PRECISION,
    "acceleration" DOUBLE PRECISION,
    "velocity" DOUBLE PRECISION,
    "volumeAcceleration" DOUBLE PRECISION,
    "priceAcceleration" DOUBLE PRECISION,
    "breakoutProbability" DOUBLE PRECISION,
    "continuationProbability" DOUBLE PRECISION,
    "exhaustionProbability" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketMomentum_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketMomentum_snapshotId_key" ON "MarketMomentum"("snapshotId");
CREATE INDEX IF NOT EXISTS "MarketMomentum_symbol_createdAt_idx" ON "MarketMomentum"("symbol", "createdAt");

CREATE TABLE IF NOT EXISTS "MarketHealth" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "healthScore" DOUBLE PRECISION NOT NULL,
    "liquidityScore" DOUBLE PRECISION,
    "spreadScore" DOUBLE PRECISION,
    "volatilityScore" DOUBLE PRECISION,
    "dataQualityScore" DOUBLE PRECISION,
    "executionQuality" DOUBLE PRECISION,
    "orderbookStability" DOUBLE PRECISION,
    "marketStability" DOUBLE PRECISION,
    "newsImpact" DOUBLE PRECISION,
    "fundingStability" DOUBLE PRECISION,
    "exchangeHealth" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketHealth_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketHealth_snapshotId_key" ON "MarketHealth"("snapshotId");
CREATE INDEX IF NOT EXISTS "MarketHealth_symbol_createdAt_idx" ON "MarketHealth"("symbol", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketHealth_healthScore_createdAt_idx" ON "MarketHealth"("healthScore", "createdAt");

CREATE TABLE IF NOT EXISTS "MarketLiquidity" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "liquidityScore" DOUBLE PRECISION,
    "depthScore" DOUBLE PRECISION,
    "spreadScore" DOUBLE PRECISION,
    "absorption" DOUBLE PRECISION,
    "sweepDetected" BOOLEAN NOT NULL DEFAULT false,
    "liquidityWall" DOUBLE PRECISION,
    "spoofDetected" BOOLEAN NOT NULL DEFAULT false,
    "icebergDetected" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketLiquidity_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketLiquidity_snapshotId_key" ON "MarketLiquidity"("snapshotId");
CREATE INDEX IF NOT EXISTS "MarketLiquidity_symbol_createdAt_idx" ON "MarketLiquidity"("symbol", "createdAt");

CREATE TABLE IF NOT EXISTS "MarketVolume" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "volumeProfile" JSONB,
    "volumeDelta" DOUBLE PRECISION,
    "relativeVolume" DOUBLE PRECISION,
    "abnormalVolume" BOOLEAN NOT NULL DEFAULT false,
    "smartMoneyVolume" DOUBLE PRECISION,
    "retailVolume" DOUBLE PRECISION,
    "whaleVolume" DOUBLE PRECISION,
    "buyingPressure" DOUBLE PRECISION,
    "sellingPressure" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketVolume_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketVolume_snapshotId_key" ON "MarketVolume"("snapshotId");
CREATE INDEX IF NOT EXISTS "MarketVolume_symbol_createdAt_idx" ON "MarketVolume"("symbol", "createdAt");

CREATE TABLE IF NOT EXISTS "SnapshotHistory" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "interval" "SnapshotInterval" NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "compressedData" JSONB NOT NULL,
    "retentionTier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SnapshotHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SnapshotHistory_symbol_interval_snapshotAt_idx" ON "SnapshotHistory"("symbol", "interval", "snapshotAt");
CREATE INDEX IF NOT EXISTS "SnapshotHistory_retentionTier_createdAt_idx" ON "SnapshotHistory"("retentionTier", "createdAt");

CREATE TABLE IF NOT EXISTS "SnapshotReplay" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "replayAt" TIMESTAMP(3) NOT NULL,
    "interval" "SnapshotInterval" NOT NULL DEFAULT 'M1',
    "snapshotId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SnapshotReplay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotReplay_symbol_replayAt_interval_key" ON "SnapshotReplay"("symbol", "replayAt", "interval");
CREATE INDEX IF NOT EXISTS "SnapshotReplay_symbol_replayAt_idx" ON "SnapshotReplay"("symbol", "replayAt");

CREATE TABLE IF NOT EXISTS "MarketIntelJobState" (
    "id" TEXT NOT NULL,
    "jobType" "MarketIntelJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketIntelJobState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketIntelJobState_jobType_key" ON "MarketIntelJobState"("jobType");

-- AddForeignKey
ALTER TABLE "MarketTrend" ADD CONSTRAINT "MarketTrend_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketMomentum" ADD CONSTRAINT "MarketMomentum_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketHealth" ADD CONSTRAINT "MarketHealth_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketLiquidity" ADD CONSTRAINT "MarketLiquidity_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketVolume" ADD CONSTRAINT "MarketVolume_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SnapshotHistory" ADD CONSTRAINT "SnapshotHistory_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "MarketSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
