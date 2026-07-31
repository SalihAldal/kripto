-- CreateEnum
CREATE TYPE "QuantResearchJobType" AS ENUM ('RESEARCH_RUN', 'STRATEGY_GENERATE', 'INDICATOR_GENERATE', 'PARAMETER_OPTIMIZE', 'BACKTEST', 'WALK_FORWARD', 'MONTE_CARLO', 'REGIME_BENCHMARK', 'STRATEGY_COMPETITION', 'STRATEGY_EVOLVE', 'FEATURE_SELECT', 'INSTITUTIONAL_BENCHMARK', 'RESEARCH_REPORT', 'SELF_DISCOVERY', 'KNOWLEDGE_SYNC');

-- CreateEnum
CREATE TYPE "ResearchRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StrategyArchetype" AS ENUM ('TREND_FOLLOWING', 'BREAKOUT', 'MOMENTUM', 'MEAN_REVERSION', 'VWAP', 'VOLUME_PROFILE', 'MARKET_STRUCTURE', 'LIQUIDITY_SWEEP', 'ORDER_BLOCK', 'FVG', 'SMC', 'MULTI_TIMEFRAME', 'HYBRID', 'AI_GENERATED', 'BASELINE', 'RANDOM');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BenchmarkType" AS ENUM ('BUY_AND_HOLD', 'BTC', 'ETH', 'SIMPLE_EMA', 'SIMPLE_RSI', 'RANDOM_ENTRY', 'PRODUCTION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ResearchReportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('NOT_ELIGIBLE', 'UNDER_REVIEW', 'ELIGIBLE', 'REJECTED', 'PROMOTED');

-- CreateEnum
CREATE TYPE "MarketRegimeType" AS ENUM ('BULL', 'BEAR', 'RANGE', 'PUMP', 'DUMP', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'NEWS_RALLY', 'MANIPULATION', 'LIQUIDITY_CRISIS');

-- CreateTable
CREATE TABLE "ResearchProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'PENDING',
    "sandboxKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'PENDING',
    "windowDays" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyGenome" (
    "id" TEXT NOT NULL,
    "genomeKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archetype" "StrategyArchetype" NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "indicators" JSONB,
    "parameters" JSONB,
    "rules" JSONB,
    "parentGenome" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyGenome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyCandidate" (
    "id" TEXT NOT NULL,
    "genomeId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "rank" INTEGER,
    "score" DOUBLE PRECISION,
    "promotionStatus" "PromotionStatus" NOT NULL DEFAULT 'NOT_ELIGIBLE',
    "metrics" JSONB,
    "blockers" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "config" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentResult" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "runId" TEXT,
    "genomeId" TEXT,
    "metrics" JSONB,
    "verdict" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Benchmark" (
    "id" TEXT NOT NULL,
    "benchmarkType" "BenchmarkType" NOT NULL,
    "symbol" TEXT,
    "genomeId" TEXT,
    "windowDays" INTEGER,
    "metrics" JSONB,
    "comparison" JSONB,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Benchmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchReport" (
    "id" TEXT NOT NULL,
    "cadence" "ResearchReportCadence" NOT NULL,
    "reportDate" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "genomeId" TEXT,
    "windowDays" INTEGER NOT NULL,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalkForwardRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "genomeId" TEXT,
    "folds" INTEGER NOT NULL DEFAULT 5,
    "trainPct" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "metrics" JSONB,
    "foldResults" JSONB,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkForwardRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonteCarloRun" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "genomeId" TEXT,
    "iterations" INTEGER NOT NULL DEFAULT 1000,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "metrics" JSONB,
    "distribution" JSONB,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonteCarloRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyEvolution" (
    "id" TEXT NOT NULL,
    "genomeId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "parentGenomeId" TEXT,
    "mutationType" TEXT,
    "fitnessScore" DOUBLE PRECISION,
    "survived" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyEvolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuantResearchKnowledge" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "refType" TEXT,
    "refId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuantResearchKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuantResearchJobState" (
    "id" TEXT NOT NULL,
    "jobType" "QuantResearchJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuantResearchJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchProject_sandboxKey_key" ON "ResearchProject"("sandboxKey");

-- CreateIndex
CREATE INDEX "ResearchProject_status_createdAt_idx" ON "ResearchProject"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_projectId_createdAt_idx" ON "ResearchRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_status_createdAt_idx" ON "ResearchRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyGenome_genomeKey_key" ON "StrategyGenome"("genomeKey");

-- CreateIndex
CREATE INDEX "StrategyGenome_archetype_generation_idx" ON "StrategyGenome"("archetype", "generation");

-- CreateIndex
CREATE INDEX "StrategyGenome_createdAt_idx" ON "StrategyGenome"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyCandidate_candidateKey_key" ON "StrategyCandidate"("candidateKey");

-- CreateIndex
CREATE INDEX "StrategyCandidate_genomeId_rank_idx" ON "StrategyCandidate"("genomeId", "rank");

-- CreateIndex
CREATE INDEX "StrategyCandidate_promotionStatus_score_idx" ON "StrategyCandidate"("promotionStatus", "score");

-- CreateIndex
CREATE INDEX "Experiment_projectId_status_idx" ON "Experiment"("projectId", "status");

-- CreateIndex
CREATE INDEX "Experiment_createdAt_idx" ON "Experiment"("createdAt");

-- CreateIndex
CREATE INDEX "ExperimentResult_experimentId_createdAt_idx" ON "ExperimentResult"("experimentId", "createdAt");

-- CreateIndex
CREATE INDEX "ExperimentResult_runId_idx" ON "ExperimentResult"("runId");

-- CreateIndex
CREATE INDEX "Benchmark_benchmarkType_recordedAt_idx" ON "Benchmark"("benchmarkType", "recordedAt");

-- CreateIndex
CREATE INDEX "Benchmark_genomeId_recordedAt_idx" ON "Benchmark"("genomeId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchReport_cadence_reportDate_key" ON "ResearchReport"("cadence", "reportDate");

-- CreateIndex
CREATE INDEX "ResearchReport_cadence_reportDate_idx" ON "ResearchReport"("cadence", "reportDate");

-- CreateIndex
CREATE INDEX "SimulationRun_runId_createdAt_idx" ON "SimulationRun"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "SimulationRun_genomeId_windowDays_idx" ON "SimulationRun"("genomeId", "windowDays");

-- CreateIndex
CREATE INDEX "WalkForwardRun_runId_createdAt_idx" ON "WalkForwardRun"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "WalkForwardRun_genomeId_passed_idx" ON "WalkForwardRun"("genomeId", "passed");

-- CreateIndex
CREATE INDEX "MonteCarloRun_runId_createdAt_idx" ON "MonteCarloRun"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "MonteCarloRun_genomeId_passed_idx" ON "MonteCarloRun"("genomeId", "passed");

-- CreateIndex
CREATE INDEX "StrategyEvolution_genomeId_generation_idx" ON "StrategyEvolution"("genomeId", "generation");

-- CreateIndex
CREATE INDEX "StrategyEvolution_survived_fitnessScore_idx" ON "StrategyEvolution"("survived", "fitnessScore");

-- CreateIndex
CREATE INDEX "QuantResearchKnowledge_category_createdAt_idx" ON "QuantResearchKnowledge"("category", "createdAt");

-- CreateIndex
CREATE INDEX "QuantResearchKnowledge_refType_refId_idx" ON "QuantResearchKnowledge"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "QuantResearchJobState_jobType_key" ON "QuantResearchJobState"("jobType");

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyCandidate" ADD CONSTRAINT "StrategyCandidate_genomeId_fkey" FOREIGN KEY ("genomeId") REFERENCES "StrategyGenome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ResearchProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentResult" ADD CONSTRAINT "ExperimentResult_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentResult" ADD CONSTRAINT "ExperimentResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationRun" ADD CONSTRAINT "SimulationRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalkForwardRun" ADD CONSTRAINT "WalkForwardRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonteCarloRun" ADD CONSTRAINT "MonteCarloRun_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ResearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyEvolution" ADD CONSTRAINT "StrategyEvolution_genomeId_fkey" FOREIGN KEY ("genomeId") REFERENCES "StrategyGenome"("id") ON DELETE CASCADE ON UPDATE CASCADE;
