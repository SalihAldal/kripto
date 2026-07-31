-- CreateEnum
CREATE TYPE "LearningEngineJobType" AS ENUM ('DECISION_LEARN', 'TRADE_LEARN', 'REJECT_LEARN', 'MISSED_OPPORTUNITY_LEARN', 'FALSE_POSITIVE_LEARN', 'PATTERN_DISCOVERY', 'FEATURE_IMPORTANCE', 'WEIGHT_RECOMMENDATION', 'DAILY_AI_REPORT', 'WEEKLY_RESEARCH', 'KNOWLEDGE_BUILD', 'CONFIDENCE_CALIBRATION', 'RESEARCH_LAB', 'MEMORY_SYNC');

-- CreateEnum
CREATE TYPE "LearningMemoryType" AS ENUM ('DECISION', 'TRADE', 'REJECT', 'PATTERN', 'MARKET', 'REPLAY', 'SHORT_TERM', 'LONG_TERM');

-- CreateEnum
CREATE TYPE "PatternLibraryStatus" AS ENUM ('WINNING', 'LOSING', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "LearningSessionStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "status" "LearningSessionStatus" NOT NULL DEFAULT 'RUNNING',
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternLibrary" (
    "id" TEXT NOT NULL,
    "patternKey" TEXT NOT NULL,
    "winRate" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "expectancy" DOUBLE PRECISION,
    "regime" TEXT,
    "hourBucket" INTEGER,
    "weekday" INTEGER,
    "status" "PatternLibraryStatus" NOT NULL DEFAULT 'NEUTRAL',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatternLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternPerformance" (
    "id" TEXT NOT NULL,
    "patternKey" TEXT NOT NULL,
    "symbol" TEXT,
    "winRate" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatternPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[],
    "patternKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightSuggestion" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "currentWeight" DOUBLE PRECISION NOT NULL,
    "suggestedWeight" DOUBLE PRECISION NOT NULL,
    "expectedWinRateDelta" DOUBLE PRECISION,
    "expectedProfitFactorDelta" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rationale" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureImportance" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureImportance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAIReport" (
    "id" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "summary" TEXT,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAIReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyResearch" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "summary" TEXT,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningMemory" (
    "id" TEXT NOT NULL,
    "memoryType" "LearningMemoryType" NOT NULL,
    "refId" TEXT,
    "symbol" TEXT,
    "payload" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionMemory" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reasoning" TEXT,
    "expertOpinions" JSONB,
    "scannerProfile" JSONB,
    "marketSnapshot" JSONB,
    "outcome" TEXT,
    "learningSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternReplay" (
    "id" TEXT NOT NULL,
    "patternKey" TEXT NOT NULL,
    "decisionId" TEXT,
    "tradeId" TEXT,
    "replayData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatternReplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfidenceCalibration" (
    "id" TEXT NOT NULL,
    "predictedBin" TEXT NOT NULL,
    "predictedAvg" DOUBLE PRECISION NOT NULL,
    "actualSuccessRate" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "calibrationError" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfidenceCalibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningEngineJobState" (
    "id" TEXT NOT NULL,
    "jobType" "LearningEngineJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningEngineJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningSession_sessionType_startedAt_idx" ON "LearningSession"("sessionType", "startedAt");

-- CreateIndex
CREATE INDEX "LearningSession_status_startedAt_idx" ON "LearningSession"("status", "startedAt");

-- CreateIndex
CREATE INDEX "PatternLibrary_patternKey_idx" ON "PatternLibrary"("patternKey");

-- CreateIndex
CREATE INDEX "PatternLibrary_status_expectancy_idx" ON "PatternLibrary"("status", "expectancy");

-- CreateIndex
CREATE INDEX "PatternLibrary_updatedAt_idx" ON "PatternLibrary"("updatedAt");

-- CreateIndex
CREATE INDEX "PatternPerformance_patternKey_recordedAt_idx" ON "PatternPerformance"("patternKey", "recordedAt");

-- CreateIndex
CREATE INDEX "PatternPerformance_symbol_recordedAt_idx" ON "PatternPerformance"("symbol", "recordedAt");

-- CreateIndex
CREATE INDEX "KnowledgeBase_category_createdAt_idx" ON "KnowledgeBase"("category", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeBase_patternKey_idx" ON "KnowledgeBase"("patternKey");

-- CreateIndex
CREATE INDEX "KnowledgeBase_createdAt_idx" ON "KnowledgeBase"("createdAt");

-- CreateIndex
CREATE INDEX "WeightSuggestion_feature_createdAt_idx" ON "WeightSuggestion"("feature", "createdAt");

-- CreateIndex
CREATE INDEX "WeightSuggestion_confidence_idx" ON "WeightSuggestion"("confidence");

-- CreateIndex
CREATE INDEX "FeatureImportance_feature_computedAt_idx" ON "FeatureImportance"("feature", "computedAt");

-- CreateIndex
CREATE INDEX "FeatureImportance_importance_idx" ON "FeatureImportance"("importance");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAIReport_reportDate_key" ON "DailyAIReport"("reportDate");

-- CreateIndex
CREATE INDEX "DailyAIReport_reportDate_idx" ON "DailyAIReport"("reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyResearch_weekStart_key" ON "WeeklyResearch"("weekStart");

-- CreateIndex
CREATE INDEX "WeeklyResearch_weekStart_idx" ON "WeeklyResearch"("weekStart");

-- CreateIndex
CREATE INDEX "LearningMemory_memoryType_createdAt_idx" ON "LearningMemory"("memoryType", "createdAt");

-- CreateIndex
CREATE INDEX "LearningMemory_refId_idx" ON "LearningMemory"("refId");

-- CreateIndex
CREATE INDEX "LearningMemory_symbol_createdAt_idx" ON "LearningMemory"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionMemory_decisionId_idx" ON "DecisionMemory"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionMemory_symbol_createdAt_idx" ON "DecisionMemory"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionMemory_decision_createdAt_idx" ON "DecisionMemory"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "PatternReplay_patternKey_createdAt_idx" ON "PatternReplay"("patternKey", "createdAt");

-- CreateIndex
CREATE INDEX "PatternReplay_decisionId_idx" ON "PatternReplay"("decisionId");

-- CreateIndex
CREATE INDEX "PatternReplay_tradeId_idx" ON "PatternReplay"("tradeId");

-- CreateIndex
CREATE INDEX "ConfidenceCalibration_predictedAvg_idx" ON "ConfidenceCalibration"("predictedAvg");

-- CreateIndex
CREATE INDEX "ConfidenceCalibration_computedAt_idx" ON "ConfidenceCalibration"("computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningEngineJobState_jobType_key" ON "LearningEngineJobState"("jobType");
