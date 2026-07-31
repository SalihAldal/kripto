-- CreateEnum
CREATE TYPE "DecisionReplayStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DecisionVerdict" AS ENUM ('CORRECT', 'PARTIALLY_CORRECT', 'WRONG', 'MISSED_WINNER', 'MISSED_BREAKOUT', 'MISSED_PUMP', 'FALSE_BUY', 'FALSE_SELL', 'EARLY_ENTRY', 'LATE_ENTRY', 'EARLY_EXIT', 'LATE_EXIT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReplayJobCadence" AS ENUM ('INCREMENTAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL', 'REJECTED_SCAN');

-- CreateEnum
CREATE TYPE "ReplayWorkerJobType" AS ENUM ('REPLAY_SINGLE', 'REPLAY_BATCH', 'REPLAY_DAILY', 'REPLAY_WEEKLY', 'REPLAY_MONTHLY', 'EVALUATE_REJECTED', 'SCAN_MISSED_OPPORTUNITIES', 'AGGREGATE_STATISTICS');

-- CreateTable
CREATE TABLE "DecisionReplay" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "originalDecision" TEXT NOT NULL,
    "decisionTime" TIMESTAMP(3) NOT NULL,
    "priceAtDecision" DOUBLE PRECISION,
    "status" "DecisionReplayStatus" NOT NULL DEFAULT 'PENDING',
    "cadence" "ReplayJobCadence" NOT NULL DEFAULT 'INCREMENTAL',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resumeCursor" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionReplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEvaluation" (
    "id" TEXT NOT NULL,
    "replayId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "verdict" "DecisionVerdict" NOT NULL DEFAULT 'UNKNOWN',
    "verdictConfidence" DOUBLE PRECISION,
    "mfePct" DOUBLE PRECISION,
    "maePct" DOUBLE PRECISION,
    "peakProfitPct" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "atrMultiple" DOUBLE PRECISION,
    "relativeStrengthAfter" DOUBLE PRECISION,
    "volumeChangePct" DOUBLE PRECISION,
    "volatilityChangePct" DOUBLE PRECISION,
    "marketRegimeAfter" TEXT,
    "horizonReturns" JSONB,
    "missedProfitPct" DOUBLE PRECISION,
    "missedLossPct" DOUBLE PRECISION,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoricalOutcome" (
    "id" TEXT NOT NULL,
    "replayId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "horizonLabel" TEXT NOT NULL,
    "horizonMs" INTEGER NOT NULL,
    "targetTime" TIMESTAMP(3) NOT NULL,
    "priceAtHorizon" DOUBLE PRECISION,
    "returnPct" DOUBLE PRECISION,
    "highSinceDecision" DOUBLE PRECISION,
    "lowSinceDecision" DOUBLE PRECISION,
    "mfePct" DOUBLE PRECISION,
    "maePct" DOUBLE PRECISION,
    "volumeRatio" DOUBLE PRECISION,
    "volatilityPct" DOUBLE PRECISION,
    "regime" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissedOpportunity" (
    "id" TEXT NOT NULL,
    "replayId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decisionTime" TIMESTAMP(3) NOT NULL,
    "priceAtDecision" DOUBLE PRECISION NOT NULL,
    "highestPrice" DOUBLE PRECISION NOT NULL,
    "lowestPrice" DOUBLE PRECISION NOT NULL,
    "bestReturnPct" DOUBLE PRECISION NOT NULL,
    "worstReturnPct" DOUBLE PRECISION NOT NULL,
    "missedProfitPct" DOUBLE PRECISION NOT NULL,
    "missedLossPct" DOUBLE PRECISION NOT NULL,
    "classification" "DecisionVerdict" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "marketRegime" TEXT,
    "reasonRejected" TEXT,
    "horizonBreakdown" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissedOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionAccuracy" (
    "id" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalDecisions" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "partiallyCorrectCount" INTEGER NOT NULL DEFAULT 0,
    "wrongCount" INTEGER NOT NULL DEFAULT 0,
    "missedWinnerCount" INTEGER NOT NULL DEFAULT 0,
    "accuracyPct" DOUBLE PRECISION,
    "avgMissedProfitPct" DOUBLE PRECISION,
    "avgConfidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionAccuracy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectAccuracy" (
    "id" TEXT NOT NULL,
    "rejectCategory" TEXT NOT NULL,
    "rejectReasonPattern" TEXT,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalRejects" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "wrongCount" INTEGER NOT NULL DEFAULT 0,
    "correctPct" DOUBLE PRECISION,
    "wrongPct" DOUBLE PRECISION,
    "avgMissedProfitPct" DOUBLE PRECISION,
    "totalMissedProfitPct" DOUBLE PRECISION,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectAccuracy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayStatistics" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "cadence" "ReplayJobCadence" NOT NULL,
    "totalReplayed" INTEGER NOT NULL DEFAULT 0,
    "totalPending" INTEGER NOT NULL DEFAULT 0,
    "totalFailed" INTEGER NOT NULL DEFAULT 0,
    "avgAccuracyPct" DOUBLE PRECISION,
    "missedWinnersCount" INTEGER NOT NULL DEFAULT 0,
    "falseRejectCount" INTEGER NOT NULL DEFAULT 0,
    "bestDecisions" JSONB,
    "worstDecisions" JSONB,
    "byStrategy" JSONB,
    "byRegime" JSONB,
    "bySymbol" JSONB,
    "byTimeframe" JSONB,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayStatistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightRecommendation" (
    "id" TEXT NOT NULL,
    "filterName" TEXT NOT NULL,
    "rejectCategory" TEXT,
    "currentWeight" DOUBLE PRECISION,
    "suggestedWeight" DOUBLE PRECISION,
    "currentThreshold" DOUBLE PRECISION,
    "suggestedThreshold" DOUBLE PRECISION,
    "expectedProfitFactorDelta" DOUBLE PRECISION,
    "expectedTradeIncreasePct" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "WeightRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionAttribution" (
    "id" TEXT NOT NULL,
    "replayId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "factorType" TEXT NOT NULL,
    "factorName" TEXT NOT NULL,
    "contributionWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "impactDirection" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayJobState" (
    "id" TEXT NOT NULL,
    "jobType" "ReplayWorkerJobType" NOT NULL,
    "cadence" "ReplayJobCadence",
    "lastProcessedAt" TIMESTAMP(3),
    "lastDecisionId" TEXT,
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DecisionReplay_decisionId_idx" ON "DecisionReplay"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionReplay_symbol_decisionTime_idx" ON "DecisionReplay"("symbol", "decisionTime");

-- CreateIndex
CREATE INDEX "DecisionReplay_status_createdAt_idx" ON "DecisionReplay"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionReplay_cadence_createdAt_idx" ON "DecisionReplay"("cadence", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionReplay_originalDecision_decisionTime_idx" ON "DecisionReplay"("originalDecision", "decisionTime");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionEvaluation_replayId_key" ON "DecisionEvaluation"("replayId");

-- CreateIndex
CREATE INDEX "DecisionEvaluation_decisionId_idx" ON "DecisionEvaluation"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionEvaluation_verdict_createdAt_idx" ON "DecisionEvaluation"("verdict", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionEvaluation_createdAt_idx" ON "DecisionEvaluation"("createdAt");

-- CreateIndex
CREATE INDEX "HistoricalOutcome_replayId_horizonLabel_idx" ON "HistoricalOutcome"("replayId", "horizonLabel");

-- CreateIndex
CREATE INDEX "HistoricalOutcome_decisionId_horizonLabel_idx" ON "HistoricalOutcome"("decisionId", "horizonLabel");

-- CreateIndex
CREATE INDEX "HistoricalOutcome_createdAt_idx" ON "HistoricalOutcome"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MissedOpportunity_replayId_key" ON "MissedOpportunity"("replayId");

-- CreateIndex
CREATE INDEX "MissedOpportunity_symbol_decisionTime_idx" ON "MissedOpportunity"("symbol", "decisionTime");

-- CreateIndex
CREATE INDEX "MissedOpportunity_classification_createdAt_idx" ON "MissedOpportunity"("classification", "createdAt");

-- CreateIndex
CREATE INDEX "MissedOpportunity_decisionId_idx" ON "MissedOpportunity"("decisionId");

-- CreateIndex
CREATE INDEX "MissedOpportunity_createdAt_idx" ON "MissedOpportunity"("createdAt");

-- CreateIndex
CREATE INDEX "DecisionAccuracy_dimension_dimensionKey_periodEnd_idx" ON "DecisionAccuracy"("dimension", "dimensionKey", "periodEnd");

-- CreateIndex
CREATE INDEX "DecisionAccuracy_computedAt_idx" ON "DecisionAccuracy"("computedAt");

-- CreateIndex
CREATE INDEX "RejectAccuracy_rejectCategory_periodEnd_idx" ON "RejectAccuracy"("rejectCategory", "periodEnd");

-- CreateIndex
CREATE INDEX "RejectAccuracy_computedAt_idx" ON "RejectAccuracy"("computedAt");

-- CreateIndex
CREATE INDEX "ReplayStatistics_cadence_periodEnd_idx" ON "ReplayStatistics"("cadence", "periodEnd");

-- CreateIndex
CREATE INDEX "ReplayStatistics_computedAt_idx" ON "ReplayStatistics"("computedAt");

-- CreateIndex
CREATE INDEX "WeightRecommendation_filterName_computedAt_idx" ON "WeightRecommendation"("filterName", "computedAt");

-- CreateIndex
CREATE INDEX "WeightRecommendation_rejectCategory_computedAt_idx" ON "WeightRecommendation"("rejectCategory", "computedAt");

-- CreateIndex
CREATE INDEX "DecisionAttribution_replayId_rank_idx" ON "DecisionAttribution"("replayId", "rank");

-- CreateIndex
CREATE INDEX "DecisionAttribution_decisionId_idx" ON "DecisionAttribution"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionAttribution_factorType_factorName_idx" ON "DecisionAttribution"("factorType", "factorName");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayJobState_jobType_key" ON "ReplayJobState"("jobType");

-- AddForeignKey
ALTER TABLE "DecisionReplay" ADD CONSTRAINT "DecisionReplay_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DecisionLog"("decisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionEvaluation" ADD CONSTRAINT "DecisionEvaluation_replayId_fkey" FOREIGN KEY ("replayId") REFERENCES "DecisionReplay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricalOutcome" ADD CONSTRAINT "HistoricalOutcome_replayId_fkey" FOREIGN KEY ("replayId") REFERENCES "DecisionReplay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedOpportunity" ADD CONSTRAINT "MissedOpportunity_replayId_fkey" FOREIGN KEY ("replayId") REFERENCES "DecisionReplay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionAttribution" ADD CONSTRAINT "DecisionAttribution_replayId_fkey" FOREIGN KEY ("replayId") REFERENCES "DecisionReplay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
