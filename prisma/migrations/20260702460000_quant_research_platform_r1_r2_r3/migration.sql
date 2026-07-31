-- AlterEnum
ALTER TYPE "QuantResearchJobType" ADD VALUE 'EXPERIMENT_RUN';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'COUNTERFACTUAL_ANALYZE';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'WALK_FORWARD_VALIDATE';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'STRATEGY_BENCHMARK';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'FEATURE_RESEARCH';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'FEATURE_ELIMINATE';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'STATISTICAL_VALIDATE';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'RECOMMENDATION_GENERATE';
ALTER TYPE "QuantResearchJobType" ADD VALUE 'HYPOTHESIS_GENERATE';

-- CreateEnum
CREATE TYPE "ResearchExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'TRAINING', 'VALIDATING', 'WALK_FORWARD', 'SHADOW_SIM', 'COMPLETED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WalkForwardMode" AS ENUM ('ROLLING', 'EXPANDING', 'PURGED', 'TIME_SERIES');

-- CreateEnum
CREATE TYPE "CounterfactualScenario" AS ENUM ('ENTER_EARLIER', 'ENTER_LATER', 'EXIT_EARLIER', 'EXIT_LATER', 'ALT_STRATEGY', 'IGNORE_TRADE', 'DOUBLE_HOLD', 'HALF_HOLD');

-- CreateEnum
CREATE TYPE "ResearchRecommendationType" AS ENUM ('NEW_STRATEGY', 'NEW_FEATURE', 'NEW_THRESHOLD', 'NEW_MODEL');

-- CreateEnum
CREATE TYPE "FeatureResearchStatus" AS ENUM ('ACTIVE', 'HIGH_VALUE', 'LOW_VALUE', 'REDUNDANT', 'CORRELATED');

-- CreateTable
CREATE TABLE "ResearchExperiment" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "strategyType" "StrategyArchetype" NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'system',
    "genomeId" TEXT,
    "hypothesis" TEXT,
    "status" "ResearchExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "runId" TEXT,
    "phase" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "metrics" JSONB,
    "evidence" JSONB,
    "verdict" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounterfactualResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT,
    "tradeId" TEXT,
    "learningTradeId" TEXT,
    "decisionId" TEXT,
    "scenario" "CounterfactualScenario" NOT NULL,
    "baselineReturnPct" DOUBLE PRECISION,
    "alternativeReturnPct" DOUBLE PRECISION,
    "alternativeDrawdownPct" DOUBLE PRECISION,
    "alternativeWinRate" DOUBLE PRECISION,
    "alternativeRR" DOUBLE PRECISION,
    "alternativeHoldSec" INTEGER,
    "metrics" JSONB,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CounterfactualResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT,
    "runId" TEXT,
    "mode" "WalkForwardMode" NOT NULL,
    "foldIndex" INTEGER NOT NULL,
    "trainStart" TIMESTAMP(3),
    "trainEnd" TIMESTAMP(3),
    "testStart" TIMESTAMP(3),
    "testEnd" TIMESTAMP(3),
    "trainMetrics" JSONB,
    "testMetrics" JSONB,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "purgeGapDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkForwardResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureResearch" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT,
    "featureKey" TEXT NOT NULL,
    "category" TEXT,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "importance" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "avgReturn" DOUBLE PRECISION,
    "correlation" DOUBLE PRECISION,
    "rank" INTEGER,
    "status" "FeatureResearchStatus" NOT NULL DEFAULT 'ACTIVE',
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyResearch" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT,
    "genomeId" TEXT,
    "strategyType" "StrategyArchetype" NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "benchmarkScore" DOUBLE PRECISION,
    "metrics" JSONB,
    "rank" INTEGER,
    "passedValidation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentMetrics" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "sharpe" DOUBLE PRECISION,
    "sortino" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "avgProfit" DOUBLE PRECISION,
    "avgLoss" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "avgHoldSec" DOUBLE PRECISION,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRecommendation" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT,
    "recommendationType" "ResearchRecommendationType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "expectedImprovement" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchExperiment_experimentId_key" ON "ResearchExperiment"("experimentId");

-- CreateIndex
CREATE INDEX "ResearchExperiment_status_createdAt_idx" ON "ResearchExperiment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchExperiment_strategyType_createdAt_idx" ON "ResearchExperiment"("strategyType", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchExperiment_author_createdAt_idx" ON "ResearchExperiment"("author", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchResult_experimentId_phase_idx" ON "ResearchResult"("experimentId", "phase");

-- CreateIndex
CREATE INDEX "ResearchResult_createdAt_idx" ON "ResearchResult"("createdAt");

-- CreateIndex
CREATE INDEX "CounterfactualResult_experimentId_scenario_idx" ON "CounterfactualResult"("experimentId", "scenario");

-- CreateIndex
CREATE INDEX "CounterfactualResult_learningTradeId_idx" ON "CounterfactualResult"("learningTradeId");

-- CreateIndex
CREATE INDEX "CounterfactualResult_decisionId_idx" ON "CounterfactualResult"("decisionId");

-- CreateIndex
CREATE INDEX "CounterfactualResult_createdAt_idx" ON "CounterfactualResult"("createdAt");

-- CreateIndex
CREATE INDEX "WalkForwardResult_experimentId_mode_foldIndex_idx" ON "WalkForwardResult"("experimentId", "mode", "foldIndex");

-- CreateIndex
CREATE INDEX "WalkForwardResult_runId_idx" ON "WalkForwardResult"("runId");

-- CreateIndex
CREATE INDEX "WalkForwardResult_createdAt_idx" ON "WalkForwardResult"("createdAt");

-- CreateIndex
CREATE INDEX "FeatureResearch_experimentId_rank_idx" ON "FeatureResearch"("experimentId", "rank");

-- CreateIndex
CREATE INDEX "FeatureResearch_featureKey_status_idx" ON "FeatureResearch"("featureKey", "status");

-- CreateIndex
CREATE INDEX "FeatureResearch_createdAt_idx" ON "FeatureResearch"("createdAt");

-- CreateIndex
CREATE INDEX "StrategyResearch_experimentId_rank_idx" ON "StrategyResearch"("experimentId", "rank");

-- CreateIndex
CREATE INDEX "StrategyResearch_genomeId_idx" ON "StrategyResearch"("genomeId");

-- CreateIndex
CREATE INDEX "StrategyResearch_strategyType_createdAt_idx" ON "StrategyResearch"("strategyType", "createdAt");

-- CreateIndex
CREATE INDEX "ExperimentMetrics_experimentId_createdAt_idx" ON "ExperimentMetrics"("experimentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRecommendation_experimentId_status_idx" ON "ResearchRecommendation"("experimentId", "status");

-- CreateIndex
CREATE INDEX "ResearchRecommendation_recommendationType_createdAt_idx" ON "ResearchRecommendation"("recommendationType", "createdAt");

-- AddForeignKey
ALTER TABLE "ResearchResult" ADD CONSTRAINT "ResearchResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounterfactualResult" ADD CONSTRAINT "CounterfactualResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardResult" ADD CONSTRAINT "WalkForwardResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureResearch" ADD CONSTRAINT "FeatureResearch_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyResearch" ADD CONSTRAINT "StrategyResearch_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentMetrics" ADD CONSTRAINT "ExperimentMetrics_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRecommendation" ADD CONSTRAINT "ResearchRecommendation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ResearchExperiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
