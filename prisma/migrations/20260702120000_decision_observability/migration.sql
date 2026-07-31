-- CreateEnum
CREATE TYPE "DecisionTimelineStage" AS ENUM ('SCANNER', 'AI', 'DECISION_ENGINE', 'RISK_ENGINE', 'TRADE', 'EVALUATION');

-- CreateTable
CREATE TABLE "DecisionLog" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "analysisId" TEXT,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannerScore" DOUBLE PRECISION,
    "technicalScore" DOUBLE PRECISION,
    "volumeScore" DOUBLE PRECISION,
    "momentumScore" DOUBLE PRECISION,
    "trendScore" DOUBLE PRECISION,
    "regimeScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "liquidityScore" DOUBLE PRECISION,
    "newsScore" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "decision" TEXT NOT NULL,
    "humanSummary" TEXT,
    "rejectReasons" JSONB,
    "reasonWeights" JSONB,
    "marketState" JSONB,
    "strategyUsed" TEXT,
    "executionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectReason" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "severity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureSnapshot" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "indicators" JSONB,
    "momentum" JSONB,
    "volume" JSONB,
    "orderBook" JSONB,
    "liquidity" JSONB,
    "spread" JSONB,
    "volatility" JSONB,
    "atr" JSONB,
    "vwap" JSONB,
    "rsi" JSONB,
    "macd" JSONB,
    "ema" JSONB,
    "regime" JSONB,
    "funding" JSONB,
    "openInterest" JSONB,
    "whale" JSONB,
    "news" JSONB,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionTimelineEvent" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "stage" "DecisionTimelineStage" NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionTimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecisionLog_decisionId_key" ON "DecisionLog"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionLog_symbol_timestamp_idx" ON "DecisionLog"("symbol", "timestamp");

-- CreateIndex
CREATE INDEX "DecisionLog_symbol_createdAt_idx" ON "DecisionLog"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "DecisionLog_decision_timestamp_idx" ON "DecisionLog"("decision", "timestamp");

-- CreateIndex
CREATE INDEX "DecisionLog_executionAllowed_timestamp_idx" ON "DecisionLog"("executionAllowed", "timestamp");

-- CreateIndex
CREATE INDEX "DecisionLog_createdAt_idx" ON "DecisionLog"("createdAt");

-- CreateIndex
CREATE INDEX "RejectReason_decisionId_idx" ON "RejectReason"("decisionId");

-- CreateIndex
CREATE INDEX "RejectReason_decisionId_rank_idx" ON "RejectReason"("decisionId", "rank");

-- CreateIndex
CREATE INDEX "RejectReason_category_idx" ON "RejectReason"("category");

-- CreateIndex
CREATE INDEX "RejectReason_createdAt_idx" ON "RejectReason"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSnapshot_decisionId_key" ON "FeatureSnapshot"("decisionId");

-- CreateIndex
CREATE INDEX "FeatureSnapshot_createdAt_idx" ON "FeatureSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "DecisionTimelineEvent_decisionId_stepOrder_idx" ON "DecisionTimelineEvent"("decisionId", "stepOrder");

-- CreateIndex
CREATE INDEX "DecisionTimelineEvent_decisionId_stage_idx" ON "DecisionTimelineEvent"("decisionId", "stage");

-- CreateIndex
CREATE INDEX "DecisionTimelineEvent_createdAt_idx" ON "DecisionTimelineEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "RejectReason" ADD CONSTRAINT "RejectReason_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DecisionLog"("decisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureSnapshot" ADD CONSTRAINT "FeatureSnapshot_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DecisionLog"("decisionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionTimelineEvent" ADD CONSTRAINT "DecisionTimelineEvent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "DecisionLog"("decisionId") ON DELETE CASCADE ON UPDATE CASCADE;
