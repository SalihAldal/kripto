-- CreateEnum
CREATE TYPE "LearningPlatformJobType" AS ENUM ('DATASET_BUILD', 'DATASET_VALIDATE', 'TRAIN_MODEL', 'EVALUATE_MODEL', 'REGISTRY_SYNC', 'COIN_LEARN', 'MARKET_MEMORY', 'TRADE_MEMORY', 'MISSED_OPPORTUNITY', 'DAILY_REPORT', 'PROMOTION_CANDIDATE');

-- CreateEnum
CREATE TYPE "TrainingDatasetStatus" AS ENUM ('BUILDING', 'VALIDATED', 'READY', 'ARCHIVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModelCandidateRole" AS ENUM ('CHAMPION', 'CHALLENGER', 'HISTORICAL_BEST', 'EXPERIMENTAL');

-- CreateEnum
CREATE TYPE "ModelCandidateStatus" AS ENUM ('PENDING', 'ELIGIBLE', 'INELIGIBLE', 'PROMOTED', 'ROLLED_BACK', 'ARCHIVED');

-- CreateTable
CREATE TABLE "TrainingDataset" (
    "id" TEXT NOT NULL,
    "datasetKey" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "labelVersion" TEXT NOT NULL,
    "trainingWindowStart" TIMESTAMP(3),
    "trainingWindowEnd" TIMESTAMP(3),
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "validRowCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedRowCount" INTEGER NOT NULL DEFAULT 0,
    "status" "TrainingDatasetStatus" NOT NULL DEFAULT 'BUILDING',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabeledDatasetRow" (
    "id" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "trainingDatasetId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "featureSnapshot" JSONB NOT NULL,
    "labels" JSONB NOT NULL,
    "executionMetrics" JSONB,
    "replayMetrics" JSONB,
    "entryMetrics" JSONB,
    "exitMetrics" JSONB,
    "marketRegime" TEXT,
    "coinCategory" TEXT,
    "pnlPct" DOUBLE PRECISION,
    "holdingTimeMinutes" DOUBLE PRECISION,
    "slippagePct" DOUBLE PRECISION,
    "feePct" DOUBLE PRECISION,
    "validationStatus" TEXT NOT NULL DEFAULT 'VALID',
    "rejectionReason" TEXT,
    "decisionTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabeledDatasetRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinProfile" (
    "id" TEXT NOT NULL,
    "profileKey" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "avgWinRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgProfitPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgLossPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bestHoldingMinutes" DOUBLE PRECISION,
    "worstHoldingMinutes" DOUBLE PRECISION,
    "bestEntryHour" INTEGER,
    "worstEntryHour" INTEGER,
    "bestMarketRegime" TEXT,
    "worstMarketRegime" TEXT,
    "avgVolatility" DOUBLE PRECISION,
    "avgSpread" DOUBLE PRECISION,
    "preferredStrategy" TEXT,
    "historicalConfidence" DOUBLE PRECISION,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketMemory" (
    "id" TEXT NOT NULL,
    "memoryKey" TEXT NOT NULL,
    "regimeType" TEXT NOT NULL,
    "similarityVector" JSONB,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "avgReturnPct" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "avgVolatility" DOUBLE PRECISION,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeMemory" (
    "id" TEXT NOT NULL,
    "memoryKey" TEXT NOT NULL,
    "tradeId" TEXT,
    "decisionId" TEXT,
    "symbol" TEXT NOT NULL,
    "whyWin" TEXT,
    "whyLoss" TEXT,
    "couldEnterEarlier" BOOLEAN NOT NULL DEFAULT false,
    "couldExitLater" BOOLEAN NOT NULL DEFAULT false,
    "strategyCorrect" BOOLEAN,
    "regimeCorrect" BOOLEAN,
    "structuredExplanation" JSONB,
    "pnlPct" DOUBLE PRECISION,
    "holdingMinutes" DOUBLE PRECISION,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningInsight" (
    "id" TEXT NOT NULL,
    "insightKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'INFO',
    "symbol" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelCandidate" (
    "id" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "trainingDatasetId" TEXT,
    "role" "ModelCandidateRole" NOT NULL DEFAULT 'EXPERIMENTAL',
    "status" "ModelCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "shadowTradeCount" INTEGER NOT NULL DEFAULT 0,
    "profitFactor" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "maxDrawdown" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "sharpe" DOUBLE PRECISION,
    "sortino" DOUBLE PRECISION,
    "auc" DOUBLE PRECISION,
    "promotionBlockers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meetsCriteria" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningReport" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "strengths" JSONB,
    "weaknesses" JSONB,
    "worstDecisions" JSONB,
    "bestDecisions" JSONB,
    "topCoins" JSONB,
    "worstCoins" JSONB,
    "bestHours" JSONB,
    "worstHours" JSONB,
    "improvements" JSONB,
    "summary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningPlatformJobState" (
    "id" TEXT NOT NULL,
    "jobType" "LearningPlatformJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningPlatformJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainingDataset_datasetKey_key" ON "TrainingDataset"("datasetKey");
CREATE UNIQUE INDEX "TrainingDataset_datasetId_key" ON "TrainingDataset"("datasetId");
CREATE INDEX "TrainingDataset_status_createdAt_idx" ON "TrainingDataset"("status", "createdAt");
CREATE INDEX "TrainingDataset_featureVersion_labelVersion_idx" ON "TrainingDataset"("featureVersion", "labelVersion");

CREATE UNIQUE INDEX "LabeledDatasetRow_rowKey_key" ON "LabeledDatasetRow"("rowKey");
CREATE UNIQUE INDEX "LabeledDatasetRow_trainingDatasetId_decisionId_key" ON "LabeledDatasetRow"("trainingDatasetId", "decisionId");
CREATE INDEX "LabeledDatasetRow_symbol_decisionTimestamp_idx" ON "LabeledDatasetRow"("symbol", "decisionTimestamp");
CREATE INDEX "LabeledDatasetRow_validationStatus_idx" ON "LabeledDatasetRow"("validationStatus");

CREATE UNIQUE INDEX "CoinProfile_profileKey_key" ON "CoinProfile"("profileKey");
CREATE UNIQUE INDEX "CoinProfile_symbol_key" ON "CoinProfile"("symbol");
CREATE INDEX "CoinProfile_avgWinRate_tradeCount_idx" ON "CoinProfile"("avgWinRate", "tradeCount");

CREATE UNIQUE INDEX "MarketMemory_memoryKey_key" ON "MarketMemory"("memoryKey");
CREATE INDEX "MarketMemory_regimeType_recordedAt_idx" ON "MarketMemory"("regimeType", "recordedAt");

CREATE UNIQUE INDEX "TradeMemory_memoryKey_key" ON "TradeMemory"("memoryKey");
CREATE INDEX "TradeMemory_symbol_recordedAt_idx" ON "TradeMemory"("symbol", "recordedAt");
CREATE INDEX "TradeMemory_tradeId_idx" ON "TradeMemory"("tradeId");

CREATE UNIQUE INDEX "LearningInsight_insightKey_key" ON "LearningInsight"("insightKey");
CREATE INDEX "LearningInsight_category_createdAt_idx" ON "LearningInsight"("category", "createdAt");
CREATE INDEX "LearningInsight_symbol_createdAt_idx" ON "LearningInsight"("symbol", "createdAt");

CREATE UNIQUE INDEX "ModelCandidate_candidateKey_key" ON "ModelCandidate"("candidateKey");
CREATE INDEX "ModelCandidate_status_role_idx" ON "ModelCandidate"("status", "role");
CREATE INDEX "ModelCandidate_modelId_idx" ON "ModelCandidate"("modelId");

CREATE UNIQUE INDEX "LearningReport_reportKey_key" ON "LearningReport"("reportKey");
CREATE INDEX "LearningReport_reportType_reportDate_idx" ON "LearningReport"("reportType", "reportDate");

CREATE UNIQUE INDEX "LearningPlatformJobState_jobType_key" ON "LearningPlatformJobState"("jobType");

-- AddForeignKey
ALTER TABLE "LabeledDatasetRow" ADD CONSTRAINT "LabeledDatasetRow_trainingDatasetId_fkey" FOREIGN KEY ("trainingDatasetId") REFERENCES "TrainingDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCandidate" ADD CONSTRAINT "ModelCandidate_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MLModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelCandidate" ADD CONSTRAINT "ModelCandidate_trainingDatasetId_fkey" FOREIGN KEY ("trainingDatasetId") REFERENCES "TrainingDataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
