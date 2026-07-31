-- CreateEnum
CREATE TYPE "ExpertType" AS ENUM ('MARKET', 'MOMENTUM', 'VOLUME', 'LIQUIDITY', 'RISK', 'NEWS', 'EXECUTION', 'LEARNING');

-- CreateEnum
CREATE TYPE "ExpertOpinionType" AS ENUM ('BUY', 'WEAK_BUY', 'HOLD', 'WEAK_SELL', 'SELL', 'NO_OPINION');

-- CreateEnum
CREATE TYPE "MasterDecisionType" AS ENUM ('STRONG_BUY', 'BUY', 'WATCHLIST', 'WAIT', 'NO_TRADE', 'REDUCE', 'SELL');

-- CreateEnum
CREATE TYPE "DecisionWatchlistStatus" AS ENUM ('ACTIVE', 'PROMOTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DecisionEngineJobType" AS ENUM ('WATCHLIST_RECHECK', 'EXPERT_REPLAY', 'EXPERT_PERFORMANCE', 'WEIGHT_RECOMMENDATION');

-- CreateTable
CREATE TABLE "ExpertOpinion" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "expertType" "ExpertType" NOT NULL,
    "opinion" "ExpertOpinionType" NOT NULL DEFAULT 'NO_OPINION',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summary" TEXT,
    "positiveFactors" JSONB,
    "negativeFactors" JSONB,
    "topRisks" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertOpinion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionMatrix" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "marketScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "momentumScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "volumeScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "liquidityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "newsScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "executionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "learningScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matrix" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsensusDecision" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decision" "MasterDecisionType" NOT NULL DEFAULT 'NO_TRADE',
    "legacyDecision" TEXT NOT NULL,
    "consensusScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conflictScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "agreementScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsensusDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionConflict" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "severity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conflicts" JSONB,
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionConsensus" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionConsensus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionExplanation" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "humanReadable" TEXT,
    "attribution" JSONB,
    "supporters" JSONB,
    "blockers" JSONB,
    "confidenceReducers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionExplanation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertPerformance" (
    "id" TEXT NOT NULL,
    "expertType" "ExpertType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "precision" DOUBLE PRECISION,
    "recall" DOUBLE PRECISION,
    "falsePositive" DOUBLE PRECISION,
    "falseNegative" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertRecommendation" (
    "id" TEXT NOT NULL,
    "expertType" "ExpertType" NOT NULL,
    "currentWeight" DOUBLE PRECISION,
    "recommendedWeight" DOUBLE PRECISION,
    "rationale" TEXT,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionWatchlist" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "status" "DecisionWatchlistStatus" NOT NULL DEFAULT 'ACTIVE',
    "recheckIntervalMin" INTEGER NOT NULL DEFAULT 5,
    "nextRecheckAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionWatchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEngineJobState" (
    "id" TEXT NOT NULL,
    "jobType" "DecisionEngineJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionEngineJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpertOpinion_decisionId_expertType_idx" ON "ExpertOpinion"("decisionId", "expertType");

-- CreateIndex
CREATE INDEX "ExpertOpinion_symbol_createdAt_idx" ON "ExpertOpinion"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "ExpertOpinion_expertType_createdAt_idx" ON "ExpertOpinion"("expertType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionMatrix_decisionId_key" ON "DecisionMatrix"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionMatrix_symbol_createdAt_idx" ON "DecisionMatrix"("symbol", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConsensusDecision_decisionId_key" ON "ConsensusDecision"("decisionId");

-- CreateIndex
CREATE INDEX "ConsensusDecision_symbol_createdAt_idx" ON "ConsensusDecision"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "ConsensusDecision_decision_createdAt_idx" ON "ConsensusDecision"("decision", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionConflict_decisionId_key" ON "DecisionConflict"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionConflict_symbol_createdAt_idx" ON "DecisionConflict"("symbol", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionConsensus_decisionId_key" ON "DecisionConsensus"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionConsensus_symbol_createdAt_idx" ON "DecisionConsensus"("symbol", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionExplanation_decisionId_key" ON "DecisionExplanation"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionExplanation_symbol_createdAt_idx" ON "DecisionExplanation"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "ExpertPerformance_expertType_periodEnd_idx" ON "ExpertPerformance"("expertType", "periodEnd");

-- CreateIndex
CREATE INDEX "ExpertPerformance_computedAt_idx" ON "ExpertPerformance"("computedAt");

-- CreateIndex
CREATE INDEX "ExpertRecommendation_expertType_computedAt_idx" ON "ExpertRecommendation"("expertType", "computedAt");

-- CreateIndex
CREATE INDEX "DecisionWatchlist_status_nextRecheckAt_idx" ON "DecisionWatchlist"("status", "nextRecheckAt");

-- CreateIndex
CREATE INDEX "DecisionWatchlist_symbol_status_idx" ON "DecisionWatchlist"("symbol", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionEngineJobState_jobType_key" ON "DecisionEngineJobState"("jobType");
