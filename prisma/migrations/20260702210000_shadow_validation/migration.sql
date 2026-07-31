-- CreateEnum
CREATE TYPE "ShadowEngineMode" AS ENUM ('PRODUCTION', 'SHADOW', 'PAPER', 'LIVE', 'SIMULATION');

-- CreateEnum
CREATE TYPE "ShadowDecisionVerdict" AS ENUM ('CORRECT', 'WRONG', 'BETTER', 'WORSE', 'EARLIER', 'LATER', 'MISSED_OPPORTUNITY', 'FALSE_ENTRY', 'FALSE_EXIT', 'PENDING');

-- CreateEnum
CREATE TYPE "ValidationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ABTestMode" AS ENUM ('SHADOW_ONLY', 'PAPER_ONLY', 'LIVE_ONLY', 'SIMULATION_ONLY', 'TRAFFIC_SPLIT');

-- CreateEnum
CREATE TYPE "ValidationReportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ShadowValidationJobType" AS ENUM ('SHADOW_CAPTURE', 'SHADOW_EVALUATE', 'REPLAY_VALIDATE', 'SIMULATION_RUN', 'DAILY_COMPARISON', 'WEEKLY_BENCHMARK', 'MONTHLY_VALIDATION', 'PROMOTION_CHECK');

-- CreateTable
CREATE TABLE "ShadowEngineRegistry" (
    "id" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "mode" "ShadowEngineMode" NOT NULL DEFAULT 'SHADOW',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trafficPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adapter" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShadowEngineRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowDecision" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "engineMode" "ShadowEngineMode" NOT NULL DEFAULT 'SHADOW',
    "decision" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "entryPrice" DOUBLE PRECISION,
    "targetPrice" DOUBLE PRECISION,
    "stopPrice" DOUBLE PRECISION,
    "reasoning" TEXT,
    "payload" JSONB,
    "productionDecision" TEXT,
    "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedAt" TIMESTAMP(3),
    "verdict" "ShadowDecisionVerdict" NOT NULL DEFAULT 'PENDING',
    "profitPct" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnginePerformance" (
    "id" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "cadence" "ValidationReportCadence" NOT NULL DEFAULT 'DAILY',
    "winRate" DOUBLE PRECISION,
    "lossRate" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "sharpeRatio" DOUBLE PRECISION,
    "sortinoRatio" DOUBLE PRECISION,
    "calmarRatio" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "avgProfitPct" DOUBLE PRECISION,
    "avgLossPct" DOUBLE PRECISION,
    "avgHoldingMin" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "avgRiskReward" DOUBLE PRECISION,
    "tradeFrequency" DOUBLE PRECISION,
    "missedWinners" INTEGER NOT NULL DEFAULT 0,
    "falseRejects" INTEGER NOT NULL DEFAULT 0,
    "falseEntries" INTEGER NOT NULL DEFAULT 0,
    "completedTrades" INTEGER NOT NULL DEFAULT 0,
    "rejectAccuracy" DOUBLE PRECISION,
    "decisionStability" DOUBLE PRECISION,
    "replayAccuracy" DOUBLE PRECISION,
    "scorecard" JSONB,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnginePerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineComparison" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "cadence" "ValidationReportCadence" NOT NULL DEFAULT 'DAILY',
    "engineA" TEXT NOT NULL,
    "engineB" TEXT NOT NULL,
    "ranking" JSONB,
    "headToHead" JSONB,
    "profitDeltaPct" DOUBLE PRECISION,
    "riskDeltaPct" DOUBLE PRECISION,
    "winnerEngineId" TEXT,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionDifference" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "productionEngineId" TEXT NOT NULL DEFAULT 'production',
    "shadowEngineId" TEXT NOT NULL,
    "productionDecision" TEXT NOT NULL,
    "shadowDecision" TEXT NOT NULL,
    "confidenceDelta" DOUBLE PRECISION,
    "reasoningDelta" TEXT,
    "disagreements" JSONB,
    "expertConflicts" JSONB,
    "profitDeltaPct" DOUBLE PRECISION,
    "winnerEngineId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionDifference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionCandidate" (
    "id" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "completedTrades" INTEGER NOT NULL DEFAULT 0,
    "profitFactor" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "sharpeRatio" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "rejectAccuracy" FLOAT,
    "decisionStability" DOUBLE PRECISION,
    "replayAccuracy" DOUBLE PRECISION,
    "blockers" JSONB,
    "rationale" TEXT,
    "metadata" JSONB,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRun" (
    "id" TEXT NOT NULL,
    "runType" TEXT NOT NULL,
    "status" "ValidationRunStatus" NOT NULL DEFAULT 'PENDING',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "engineIds" JSONB,
    "summary" JSONB,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "ABTestMode" NOT NULL DEFAULT 'SHADOW_ONLY',
    "trafficPct" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "engineIds" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "results" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ABTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "engineId" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "decisions" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "sharpeRatio" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "comparison" JSONB,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayComparison" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "replayDecision" TEXT,
    "productionDecision" TEXT,
    "verdict" "ShadowDecisionVerdict" NOT NULL DEFAULT 'PENDING',
    "profitDeltaPct" DOUBLE PRECISION,
    "mfePct" DOUBLE PRECISION,
    "maePct" DOUBLE PRECISION,
    "metadata" JSONB,
    "comparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShadowValidationJobState" (
    "id" TEXT NOT NULL,
    "jobType" "ShadowValidationJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShadowValidationJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShadowEngineRegistry_engineId_key" ON "ShadowEngineRegistry"("engineId");

-- CreateIndex
CREATE INDEX "ShadowEngineRegistry_enabled_mode_idx" ON "ShadowEngineRegistry"("enabled", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowDecision_decisionId_engineId_key" ON "ShadowDecision"("decisionId", "engineId");

-- CreateIndex
CREATE INDEX "ShadowDecision_symbol_capturedAt_idx" ON "ShadowDecision"("symbol", "capturedAt");

-- CreateIndex
CREATE INDEX "ShadowDecision_engineId_verdict_idx" ON "ShadowDecision"("engineId", "verdict");

-- CreateIndex
CREATE INDEX "ShadowDecision_decisionId_idx" ON "ShadowDecision"("decisionId");

-- CreateIndex
CREATE INDEX "EnginePerformance_engineId_periodEnd_idx" ON "EnginePerformance"("engineId", "periodEnd");

-- CreateIndex
CREATE INDEX "EnginePerformance_cadence_computedAt_idx" ON "EnginePerformance"("cadence", "computedAt");

-- CreateIndex
CREATE INDEX "EngineComparison_periodEnd_cadence_idx" ON "EngineComparison"("periodEnd", "cadence");

-- CreateIndex
CREATE INDEX "EngineComparison_engineA_engineB_idx" ON "EngineComparison"("engineA", "engineB");

-- CreateIndex
CREATE INDEX "DecisionDifference_decisionId_idx" ON "DecisionDifference"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionDifference_symbol_createdAt_idx" ON "DecisionDifference"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionDifference_shadowEngineId_createdAt_idx" ON "DecisionDifference"("shadowEngineId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionCandidate_engineId_evaluatedAt_idx" ON "PromotionCandidate"("engineId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "PromotionCandidate_eligible_evaluatedAt_idx" ON "PromotionCandidate"("eligible", "evaluatedAt");

-- CreateIndex
CREATE INDEX "ValidationRun_runType_status_idx" ON "ValidationRun"("runType", "status");

-- CreateIndex
CREATE INDEX "ValidationRun_createdAt_idx" ON "ValidationRun"("createdAt");

-- CreateIndex
CREATE INDEX "ABTest_active_mode_idx" ON "ABTest"("active", "mode");

-- CreateIndex
CREATE INDEX "SimulationResult_engineId_windowDays_computedAt_idx" ON "SimulationResult"("engineId", "windowDays", "computedAt");

-- CreateIndex
CREATE INDEX "SimulationResult_runId_idx" ON "SimulationResult"("runId");

-- CreateIndex
CREATE INDEX "ReplayComparison_decisionId_engineId_idx" ON "ReplayComparison"("decisionId", "engineId");

-- CreateIndex
CREATE INDEX "ReplayComparison_symbol_comparedAt_idx" ON "ReplayComparison"("symbol", "comparedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShadowValidationJobState_jobType_key" ON "ShadowValidationJobState"("jobType");
