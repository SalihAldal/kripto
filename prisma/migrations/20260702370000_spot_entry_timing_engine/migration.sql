-- Spot Entry Timing Engine Migration 20260702370000
CREATE TYPE "EntryTimingJobType" AS ENUM ('ANALYZE_ENTRY', 'CONFIRM_ENTRY', 'FILTER_CHECK', 'WAIT_REEVALUATE', 'QUALITY_SCORE', 'REPLAY_ENTRY', 'LEARN_PATTERNS', 'HEATMAP_BUILD', 'RECOMMENDATION');
CREATE TYPE "SpotEntryType" AS ENUM ('BREAKOUT', 'RETEST', 'PULLBACK', 'MOMENTUM', 'TREND_CONTINUATION', 'RANGE_BOUNCE', 'SUPPORT_BOUNCE', 'RESISTANCE_FLIP', 'VWAP', 'LIQUIDITY_SWEEP', 'NEWS');
CREATE TYPE "EntryVerdict" AS ENUM ('BUY', 'WAIT', 'REJECT');
CREATE TYPE "WaitDuration" AS ENUM ('MINUTES_5', 'MINUTES_15', 'MINUTES_30', 'HOUR_1');
CREATE TYPE "EntryFilterReason" AS ENUM ('FAKE_BREAKOUT_RISK', 'WEAK_VOLUME', 'DISTRIBUTION', 'EXTREME_OVEREXTENSION', 'LIQUIDITY_TRAP', 'NEWS_UNCERTAINTY', 'EXCHANGE_INSTABILITY', 'LOW_CONFIDENCE');

CREATE TABLE "EntryAnalysis" (
  "id" TEXT NOT NULL,
  "analysisKey" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "priceAtAnalysis" DOUBLE PRECISION NOT NULL,
  "verdict" "EntryVerdict" NOT NULL DEFAULT 'WAIT',
  "entryType" "SpotEntryType",
  "entryScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "entryConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "entryRisk" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "breakoutProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "continuationProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "pullbackProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "fakeBreakoutProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reversalProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "waitDuration" "WaitDuration",
  "reevaluateAt" TIMESTAMP(3),
  "trendScore" DOUBLE PRECISION,
  "momentumScore" DOUBLE PRECISION,
  "volumeScore" DOUBLE PRECISION,
  "liquidityScore" DOUBLE PRECISION,
  "orderBookScore" DOUBLE PRECISION,
  "volatilityScore" DOUBLE PRECISION,
  "supportScore" DOUBLE PRECISION,
  "resistanceScore" DOUBLE PRECISION,
  "structureScore" DOUBLE PRECISION,
  "regimeScore" DOUBLE PRECISION,
  "newsScore" DOUBLE PRECISION,
  "whaleScore" DOUBLE PRECISION,
  "onChainScore" DOUBLE PRECISION,
  "microStructure" JSONB,
  "filterReasons" "EntryFilterReason"[],
  "filterPassed" BOOLEAN NOT NULL DEFAULT true,
  "analysisPayload" JSONB,
  "metadata" JSONB,
  "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntryAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntryReplay" (
  "id" TEXT NOT NULL,
  "replayKey" TEXT NOT NULL,
  "analysisId" TEXT,
  "symbol" TEXT NOT NULL,
  "entryPrice" DOUBLE PRECISION NOT NULL,
  "entryAt" TIMESTAMP(3) NOT NULL,
  "optimalPrice" DOUBLE PRECISION,
  "optimalAt" TIMESTAMP(3),
  "wasOptimal" BOOLEAN NOT NULL DEFAULT false,
  "couldEnterEarlier" BOOLEAN NOT NULL DEFAULT false,
  "couldEnterLater" BOOLEAN NOT NULL DEFAULT false,
  "profitDifferencePct" DOUBLE PRECISION,
  "mfePct" DOUBLE PRECISION,
  "maePct" DOUBLE PRECISION,
  "replayVerdict" TEXT,
  "replayPayload" JSONB,
  "metadata" JSONB,
  "replayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntryReplay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntryQuality" (
  "id" TEXT NOT NULL,
  "qualityKey" TEXT NOT NULL,
  "analysisId" TEXT,
  "symbol" TEXT NOT NULL,
  "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedRr" DOUBLE PRECISION,
  "expectedSuccess" DOUBLE PRECISION,
  "expectedHoldMinutes" DOUBLE PRECISION,
  "expectedVolatility" DOUBLE PRECISION,
  "metadata" JSONB,
  "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntryQuality_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntryPattern" (
  "id" TEXT NOT NULL,
  "patternKey" TEXT NOT NULL,
  "patternType" "SpotEntryType" NOT NULL,
  "symbol" TEXT,
  "hourOfDay" INTEGER,
  "regime" TEXT,
  "structure" TEXT,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
  "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "avgQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "isWorst" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "learnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EntryPattern_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntryRecommendation" (
  "id" TEXT NOT NULL,
  "recommendationKey" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "verdict" "EntryVerdict" NOT NULL,
  "entryType" "SpotEntryType",
  "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL,
  "reasons" TEXT[],
  "waitUntil" TIMESTAMP(3),
  "metadata" JSONB,
  "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "EntryRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntryTimingJobState" (
  "id" TEXT NOT NULL,
  "jobType" "EntryTimingJobType" NOT NULL,
  "lastProcessedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntryTimingJobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntryAnalysis_analysisKey_key" ON "EntryAnalysis"("analysisKey");
CREATE INDEX "EntryAnalysis_symbol_analyzedAt_idx" ON "EntryAnalysis"("symbol", "analyzedAt");
CREATE INDEX "EntryAnalysis_verdict_analyzedAt_idx" ON "EntryAnalysis"("verdict", "analyzedAt");
CREATE INDEX "EntryAnalysis_entryType_analyzedAt_idx" ON "EntryAnalysis"("entryType", "analyzedAt");
CREATE INDEX "EntryAnalysis_reevaluateAt_idx" ON "EntryAnalysis"("reevaluateAt");

CREATE UNIQUE INDEX "EntryReplay_replayKey_key" ON "EntryReplay"("replayKey");
CREATE INDEX "EntryReplay_symbol_replayedAt_idx" ON "EntryReplay"("symbol", "replayedAt");
CREATE INDEX "EntryReplay_analysisId_idx" ON "EntryReplay"("analysisId");
CREATE INDEX "EntryReplay_wasOptimal_replayedAt_idx" ON "EntryReplay"("wasOptimal", "replayedAt");

CREATE UNIQUE INDEX "EntryQuality_qualityKey_key" ON "EntryQuality"("qualityKey");
CREATE INDEX "EntryQuality_symbol_scoredAt_idx" ON "EntryQuality"("symbol", "scoredAt");
CREATE INDEX "EntryQuality_qualityScore_scoredAt_idx" ON "EntryQuality"("qualityScore", "scoredAt");
CREATE INDEX "EntryQuality_analysisId_idx" ON "EntryQuality"("analysisId");

CREATE UNIQUE INDEX "EntryPattern_patternKey_key" ON "EntryPattern"("patternKey");
CREATE INDEX "EntryPattern_patternType_successRate_idx" ON "EntryPattern"("patternType", "successRate");
CREATE INDEX "EntryPattern_hourOfDay_patternType_idx" ON "EntryPattern"("hourOfDay", "patternType");
CREATE INDEX "EntryPattern_regime_patternType_idx" ON "EntryPattern"("regime", "patternType");
CREATE INDEX "EntryPattern_isWorst_avgQualityScore_idx" ON "EntryPattern"("isWorst", "avgQualityScore");

CREATE UNIQUE INDEX "EntryRecommendation_recommendationKey_key" ON "EntryRecommendation"("recommendationKey");
CREATE INDEX "EntryRecommendation_symbol_recommendedAt_idx" ON "EntryRecommendation"("symbol", "recommendedAt");
CREATE INDEX "EntryRecommendation_verdict_recommendedAt_idx" ON "EntryRecommendation"("verdict", "recommendedAt");
CREATE INDEX "EntryRecommendation_analysisId_idx" ON "EntryRecommendation"("analysisId");

CREATE UNIQUE INDEX "EntryTimingJobState_jobType_key" ON "EntryTimingJobState"("jobType");

ALTER TABLE "EntryReplay" ADD CONSTRAINT "EntryReplay_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "EntryAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntryQuality" ADD CONSTRAINT "EntryQuality_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "EntryAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntryRecommendation" ADD CONSTRAINT "EntryRecommendation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "EntryAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
