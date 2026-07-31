-- Trading Core Sprint 2: G1 Regime + T1 Discovery V2 + T2 Momentum Breakout
CREATE TYPE "SpotMarketRegimeLabel" AS ENUM ('STRONG_BULL', 'WEAK_BULL', 'STRONG_BEAR', 'WEAK_BEAR', 'SIDEWAYS', 'ACCUMULATION', 'DISTRIBUTION', 'BREAKOUT', 'FAKE_BREAKOUT', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'PUMP', 'DUMP');
CREATE TYPE "MomentumBreakoutVerdict" AS ENUM ('BUY_CANDIDATE', 'WAIT', 'IGNORE');
CREATE TYPE "TradingCoreS2JobType" AS ENUM ('REGIME_REFRESH', 'DISCOVERY_SCAN', 'DISCOVERY_RANKING', 'MOMENTUM_EVALUATE', 'STATISTICS_UPDATE');

CREATE TABLE "MarketRegimeSnapshot" (
  "id" TEXT NOT NULL,
  "regimeKey" TEXT NOT NULL,
  "regime" "SpotMarketRegimeLabel" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "regimeStrength" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedDurationMinutes" INTEGER,
  "supportingFeatures" JSONB NOT NULL,
  "historicalSimilarity" DOUBLE PRECISION,
  "btcTrend" DOUBLE PRECISION,
  "ethTrend" DOUBLE PRECISION,
  "btcDominance" DOUBLE PRECISION,
  "volumeExpansion" DOUBLE PRECISION,
  "atrPercent" DOUBLE PRECISION,
  "realizedVolatility" DOUBLE PRECISION,
  "marketBreadth" DOUBLE PRECISION,
  "usdtPairStrength" DOUBLE PRECISION,
  "relativeStrength" DOUBLE PRECISION,
  "marketMomentum" DOUBLE PRECISION,
  "metadata" JSONB,
  "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketRegimeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketRegimeHistory" (
  "id" TEXT NOT NULL,
  "regime" "SpotMarketRegimeLabel" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "regimeStrength" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "supportingFeatures" JSONB NOT NULL,
  "historicalSimilarity" DOUBLE PRECISION,
  "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketRegimeHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoverySnapshot" (
  "id" TEXT NOT NULL,
  "snapshotKey" TEXT NOT NULL,
  "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "totalSymbols" INTEGER NOT NULL DEFAULT 0,
  "rankedSymbols" INTEGER NOT NULL DEFAULT 0,
  "marketRegime" "SpotMarketRegimeLabel",
  "report" JSONB,
  "metadata" JSONB,
  CONSTRAINT "DiscoverySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryRanking" (
  "id" TEXT NOT NULL,
  "rankingKey" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "discoveryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "category" TEXT,
  "metadata" JSONB,
  "rankedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoveryRanking_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryScore" (
  "id" TEXT NOT NULL,
  "scoreKey" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "discoveryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "momentumScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "volumeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "relativeVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "breakoutScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "liquidityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "spreadScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "volatilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "relativeBtcStrength" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "relativeEthStrength" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "regimeCompatibility" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rejected" BOOLEAN NOT NULL DEFAULT false,
  "rejectReason" TEXT,
  "metadata" JSONB,
  "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoveryScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DiscoveryCandidate" (
  "id" TEXT NOT NULL,
  "candidateKey" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "rank" INTEGER NOT NULL,
  "discoveryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reportCategory" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MomentumBreakoutCandidate" (
  "id" TEXT NOT NULL,
  "candidateKey" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "snapshotId" TEXT,
  "marketRegime" "SpotMarketRegimeLabel",
  "verdict" "MomentumBreakoutVerdict" NOT NULL DEFAULT 'IGNORE',
  "entryProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedRr" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedHoldingMinutes" INTEGER,
  "expectedVolatility" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "relativeVolume" DOUBLE PRECISION,
  "momentum5m" DOUBLE PRECISION,
  "momentum15m" DOUBLE PRECISION,
  "relativeBtcStrength" DOUBLE PRECISION,
  "relativeEthStrength" DOUBLE PRECISION,
  "spreadPercent" DOUBLE PRECISION,
  "features" JSONB,
  "metadata" JSONB,
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MomentumBreakoutCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MomentumBreakoutStatistics" (
  "id" TEXT NOT NULL,
  "statsKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "hitRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "averageProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "averageLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "profitFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectancy" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sharpe" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxDrawdown" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sampleSize" INT NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MomentumBreakoutStatistics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradingCoreS2JobState" (
  "id" TEXT NOT NULL,
  "jobType" "TradingCoreS2JobType" NOT NULL,
  "lastProcessedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradingCoreS2JobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketRegimeSnapshot_regimeKey_key" ON "MarketRegimeSnapshot"("regimeKey");
CREATE INDEX "MarketRegimeSnapshot_regime_classifiedAt_idx" ON "MarketRegimeSnapshot"("regime", "classifiedAt");
CREATE INDEX "MarketRegimeSnapshot_classifiedAt_idx" ON "MarketRegimeSnapshot"("classifiedAt");
CREATE INDEX "MarketRegimeHistory_classifiedAt_idx" ON "MarketRegimeHistory"("classifiedAt");
CREATE INDEX "MarketRegimeHistory_regime_classifiedAt_idx" ON "MarketRegimeHistory"("regime", "classifiedAt");
CREATE UNIQUE INDEX "DiscoverySnapshot_snapshotKey_key" ON "DiscoverySnapshot"("snapshotKey");
CREATE INDEX "DiscoverySnapshot_scannedAt_idx" ON "DiscoverySnapshot"("scannedAt");
CREATE UNIQUE INDEX "DiscoveryRanking_rankingKey_key" ON "DiscoveryRanking"("rankingKey");
CREATE INDEX "DiscoveryRanking_snapshotId_rank_idx" ON "DiscoveryRanking"("snapshotId", "rank");
CREATE INDEX "DiscoveryRanking_symbol_rankedAt_idx" ON "DiscoveryRanking"("symbol", "rankedAt");
CREATE UNIQUE INDEX "DiscoveryScore_scoreKey_key" ON "DiscoveryScore"("scoreKey");
CREATE INDEX "DiscoveryScore_snapshotId_discoveryScore_idx" ON "DiscoveryScore"("snapshotId", "discoveryScore");
CREATE INDEX "DiscoveryScore_symbol_scoredAt_idx" ON "DiscoveryScore"("symbol", "scoredAt");
CREATE UNIQUE INDEX "DiscoveryCandidate_candidateKey_key" ON "DiscoveryCandidate"("candidateKey");
CREATE INDEX "DiscoveryCandidate_snapshotId_rank_idx" ON "DiscoveryCandidate"("snapshotId", "rank");
CREATE INDEX "DiscoveryCandidate_symbol_createdAt_idx" ON "DiscoveryCandidate"("symbol", "createdAt");
CREATE UNIQUE INDEX "MomentumBreakoutCandidate_candidateKey_key" ON "MomentumBreakoutCandidate"("candidateKey");
CREATE INDEX "MomentumBreakoutCandidate_symbol_evaluatedAt_idx" ON "MomentumBreakoutCandidate"("symbol", "evaluatedAt");
CREATE INDEX "MomentumBreakoutCandidate_verdict_evaluatedAt_idx" ON "MomentumBreakoutCandidate"("verdict", "evaluatedAt");
CREATE INDEX "MomentumBreakoutCandidate_marketRegime_evaluatedAt_idx" ON "MomentumBreakoutCandidate"("marketRegime", "evaluatedAt");
CREATE UNIQUE INDEX "MomentumBreakoutStatistics_statsKey_key" ON "MomentumBreakoutStatistics"("statsKey");
CREATE INDEX "MomentumBreakoutStatistics_calculatedAt_idx" ON "MomentumBreakoutStatistics"("calculatedAt");
CREATE INDEX "MomentumBreakoutStatistics_periodStart_periodEnd_idx" ON "MomentumBreakoutStatistics"("periodStart", "periodEnd");
CREATE UNIQUE INDEX "TradingCoreS2JobState_jobType_key" ON "TradingCoreS2JobState"("jobType");

ALTER TABLE "DiscoveryRanking" ADD CONSTRAINT "DiscoveryRanking_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DiscoverySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryScore" ADD CONSTRAINT "DiscoveryScore_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DiscoverySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscoveryCandidate" ADD CONSTRAINT "DiscoveryCandidate_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "DiscoverySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
