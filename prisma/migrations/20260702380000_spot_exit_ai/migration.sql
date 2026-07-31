-- Spot Exit AI Migration 20260702380000
CREATE TYPE "ExitTimingJobType" AS ENUM ('ANALYZE_EXIT', 'PROFIT_PROTECTION', 'EXIT_SCORE', 'HOLD_REEVALUATE', 'EXIT_QUALITY', 'REPLAY_EXIT', 'LEARN_EXITS', 'RECOMMENDATION', 'POSITION_SCAN');
CREATE TYPE "SpotExitType" AS ENUM ('TREND_EXHAUSTION', 'MOMENTUM_LOSS', 'DISTRIBUTION', 'LIQUIDITY_SWEEP', 'NEWS_REVERSAL', 'BREAKDOWN', 'SUPPORT_BREAK', 'PROFIT_TARGET', 'EMERGENCY_EXIT', 'TIME_EXIT');
CREATE TYPE "ExitVerdict" AS ENUM ('SELL', 'HOLD');
CREATE TYPE "HoldDuration" AS ENUM ('MINUTES_5', 'MINUTES_15', 'MINUTES_30', 'HOUR_1', 'HOURS_4');
CREATE TYPE "PartialExitPct" AS ENUM ('PCT_25', 'PCT_50', 'PCT_75', 'PCT_100');
CREATE TYPE "TrailingMode" AS ENUM ('DISABLED', 'ATR_TRAILING', 'DYNAMIC_TRAILING', 'PERCENTAGE_TRAILING', 'VOLATILITY_TRAILING');

CREATE TABLE "ExitAnalysis" (
  "id" TEXT NOT NULL,
  "analysisKey" TEXT NOT NULL,
  "positionId" TEXT,
  "symbol" TEXT NOT NULL,
  "entryPrice" DOUBLE PRECISION NOT NULL,
  "currentPrice" DOUBLE PRECISION NOT NULL,
  "currentProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "currentLossPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "verdict" "ExitVerdict" NOT NULL DEFAULT 'HOLD',
  "exitType" "SpotExitType",
  "exitScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "exitConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedRemainingUpside" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedDownside" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "continuationProbability" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "reversalProbability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "holdDuration" "HoldDuration",
  "reevaluateAt" TIMESTAMP(3),
  "momentumScore" DOUBLE PRECISION,
  "trendScore" DOUBLE PRECISION,
  "volumeScore" DOUBLE PRECISION,
  "regimeScore" DOUBLE PRECISION,
  "orderBookScore" DOUBLE PRECISION,
  "liquidityScore" DOUBLE PRECISION,
  "newsScore" DOUBLE PRECISION,
  "whaleScore" DOUBLE PRECISION,
  "onChainScore" DOUBLE PRECISION,
  "volatilityScore" DOUBLE PRECISION,
  "atrValue" DOUBLE PRECISION,
  "vwapDistance" DOUBLE PRECISION,
  "supportScore" DOUBLE PRECISION,
  "resistanceScore" DOUBLE PRECISION,
  "partialExitPct" "PartialExitPct" NOT NULL DEFAULT 'PCT_100',
  "trailingMode" "TrailingMode" NOT NULL DEFAULT 'DISABLED',
  "analysisPayload" JSONB,
  "metadata" JSONB,
  "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExitAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProfitProtection" (
  "id" TEXT NOT NULL,
  "protectionKey" TEXT NOT NULL,
  "analysisId" TEXT,
  "positionId" TEXT,
  "symbol" TEXT NOT NULL,
  "lockedProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "openProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maximumProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "profitGivebackPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "drawdownFromPeakPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfitProtection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExitReplay" (
  "id" TEXT NOT NULL,
  "replayKey" TEXT NOT NULL,
  "analysisId" TEXT,
  "symbol" TEXT NOT NULL,
  "exitPrice" DOUBLE PRECISION NOT NULL,
  "exitAt" TIMESTAMP(3) NOT NULL,
  "bestPossiblePrice" DOUBLE PRECISION,
  "bestPossibleAt" TIMESTAMP(3),
  "actualProfitPct" DOUBLE PRECISION,
  "bestPossibleProfitPct" DOUBLE PRECISION,
  "profitDifferencePct" DOUBLE PRECISION,
  "lostProfitPct" DOUBLE PRECISION,
  "savedLossPct" DOUBLE PRECISION,
  "wasOptimal" BOOLEAN NOT NULL DEFAULT false,
  "couldExitEarlier" BOOLEAN NOT NULL DEFAULT false,
  "couldExitLater" BOOLEAN NOT NULL DEFAULT false,
  "replayVerdict" TEXT,
  "replayPayload" JSONB,
  "metadata" JSONB,
  "replayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExitReplay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExitQuality" (
  "id" TEXT NOT NULL,
  "qualityKey" TEXT NOT NULL,
  "analysisId" TEXT,
  "symbol" TEXT NOT NULL,
  "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "extraProfitPossiblePct" DOUBLE PRECISION,
  "drawdownAvoidablePct" DOUBLE PRECISION,
  "couldExitEarlier" BOOLEAN NOT NULL DEFAULT false,
  "couldExitLater" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExitQuality_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExitRecommendation" (
  "id" TEXT NOT NULL,
  "recommendationKey" TEXT NOT NULL,
  "analysisId" TEXT NOT NULL,
  "positionId" TEXT,
  "symbol" TEXT NOT NULL,
  "verdict" "ExitVerdict" NOT NULL,
  "exitType" "SpotExitType",
  "exitScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "summary" TEXT NOT NULL,
  "reasons" TEXT[],
  "sellPct" "PartialExitPct" NOT NULL DEFAULT 'PCT_100',
  "holdUntil" TIMESTAMP(3),
  "metadata" JSONB,
  "recommendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "ExitRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExitLearning" (
  "id" TEXT NOT NULL,
  "learningKey" TEXT NOT NULL,
  "exitType" "SpotExitType",
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
  CONSTRAINT "ExitLearning_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExitTimingJobState" (
  "id" TEXT NOT NULL,
  "jobType" "ExitTimingJobType" NOT NULL,
  "lastProcessedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExitTimingJobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExitAnalysis_analysisKey_key" ON "ExitAnalysis"("analysisKey");
CREATE INDEX "ExitAnalysis_symbol_analyzedAt_idx" ON "ExitAnalysis"("symbol", "analyzedAt");
CREATE INDEX "ExitAnalysis_positionId_analyzedAt_idx" ON "ExitAnalysis"("positionId", "analyzedAt");
CREATE INDEX "ExitAnalysis_verdict_analyzedAt_idx" ON "ExitAnalysis"("verdict", "analyzedAt");
CREATE INDEX "ExitAnalysis_reevaluateAt_idx" ON "ExitAnalysis"("reevaluateAt");

CREATE UNIQUE INDEX "ProfitProtection_protectionKey_key" ON "ProfitProtection"("protectionKey");
CREATE INDEX "ProfitProtection_symbol_recordedAt_idx" ON "ProfitProtection"("symbol", "recordedAt");
CREATE INDEX "ProfitProtection_positionId_recordedAt_idx" ON "ProfitProtection"("positionId", "recordedAt");
CREATE INDEX "ProfitProtection_analysisId_idx" ON "ProfitProtection"("analysisId");

CREATE UNIQUE INDEX "ExitReplay_replayKey_key" ON "ExitReplay"("replayKey");
CREATE INDEX "ExitReplay_symbol_replayedAt_idx" ON "ExitReplay"("symbol", "replayedAt");
CREATE INDEX "ExitReplay_analysisId_idx" ON "ExitReplay"("analysisId");
CREATE INDEX "ExitReplay_wasOptimal_replayedAt_idx" ON "ExitReplay"("wasOptimal", "replayedAt");

CREATE UNIQUE INDEX "ExitQuality_qualityKey_key" ON "ExitQuality"("qualityKey");
CREATE INDEX "ExitQuality_symbol_scoredAt_idx" ON "ExitQuality"("symbol", "scoredAt");
CREATE INDEX "ExitQuality_qualityScore_scoredAt_idx" ON "ExitQuality"("qualityScore", "scoredAt");
CREATE INDEX "ExitQuality_analysisId_idx" ON "ExitQuality"("analysisId");

CREATE UNIQUE INDEX "ExitRecommendation_recommendationKey_key" ON "ExitRecommendation"("recommendationKey");
CREATE INDEX "ExitRecommendation_symbol_recommendedAt_idx" ON "ExitRecommendation"("symbol", "recommendedAt");
CREATE INDEX "ExitRecommendation_verdict_recommendedAt_idx" ON "ExitRecommendation"("verdict", "recommendedAt");
CREATE INDEX "ExitRecommendation_positionId_idx" ON "ExitRecommendation"("positionId");
CREATE INDEX "ExitRecommendation_analysisId_idx" ON "ExitRecommendation"("analysisId");

CREATE UNIQUE INDEX "ExitLearning_learningKey_key" ON "ExitLearning"("learningKey");
CREATE INDEX "ExitLearning_exitType_successRate_idx" ON "ExitLearning"("exitType", "successRate");
CREATE INDEX "ExitLearning_hourOfDay_exitType_idx" ON "ExitLearning"("hourOfDay", "exitType");
CREATE INDEX "ExitLearning_isWorst_avgQualityScore_idx" ON "ExitLearning"("isWorst", "avgQualityScore");

CREATE UNIQUE INDEX "ExitTimingJobState_jobType_key" ON "ExitTimingJobState"("jobType");

ALTER TABLE "ProfitProtection" ADD CONSTRAINT "ProfitProtection_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ExitAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExitReplay" ADD CONSTRAINT "ExitReplay_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ExitAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExitQuality" ADD CONSTRAINT "ExitQuality_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ExitAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExitRecommendation" ADD CONSTRAINT "ExitRecommendation_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ExitAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
