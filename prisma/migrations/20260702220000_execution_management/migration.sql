-- CreateEnum
CREATE TYPE "PositionSizingMode" AS ENUM ('ALL_IN', 'FIXED_AMOUNT', 'FIXED_PERCENT', 'VOLATILITY_BASED', 'RISK_BASED', 'KELLY', 'EQUAL_WEIGHT');

-- CreateEnum
CREATE TYPE "ExecutionValidationStage" AS ENUM ('RISK', 'POSITION', 'EXCHANGE', 'BALANCE', 'COMPLETE');

-- CreateEnum
CREATE TYPE "ExecutionMgmtJobType" AS ENUM ('EXECUTION_VALIDATE', 'POSITION_SYNC', 'PORTFOLIO_SNAPSHOT', 'EXECUTION_REPLAY', 'STATISTICS_AGGREGATE');

-- CreateTable
CREATE TABLE "PositionSizing" (
    "id" TEXT NOT NULL,
    "executionId" TEXT,
    "userId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "mode" "PositionSizingMode" NOT NULL DEFAULT 'ALL_IN',
    "quoteAsset" TEXT,
    "baseAsset" TEXT,
    "availableQuote" DOUBLE PRECISION,
    "availableBase" DOUBLE PRECISION,
    "requestedQty" DOUBLE PRECISION,
    "sizedQty" DOUBLE PRECISION,
    "quoteSpend" DOUBLE PRECISION,
    "utilizationPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionSizing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionValidation" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "stage" "ExecutionValidationStage" NOT NULL DEFAULT 'RISK',
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB,
    "marketPrice" DOUBLE PRECISION,
    "notional" DOUBLE PRECISION,
    "adjustedQty" DOUBLE PRECISION,
    "minNotional" DOUBLE PRECISION,
    "feesEstimate" DOUBLE PRECISION,
    "metadata" JSONB,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutionValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionReplay" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "orderId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "requestedQty" DOUBLE PRECISION,
    "executedQty" DOUBLE PRECISION,
    "requestedPrice" DOUBLE PRECISION,
    "executionPrice" DOUBLE PRECISION,
    "slippagePct" DOUBLE PRECISION,
    "fees" DOUBLE PRECISION,
    "fillRatio" DOUBLE PRECISION,
    "positionBefore" JSONB,
    "positionAfter" JSONB,
    "metadata" JSONB,
    "replayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutionReplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionStatistics" (
    "id" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'all',
    "successRate" DOUBLE PRECISION,
    "avgSlippagePct" DOUBLE PRECISION,
    "avgFillTimeMs" DOUBLE PRECISION,
    "rejectedOrders" INTEGER NOT NULL DEFAULT 0,
    "failedOrders" INTEGER NOT NULL DEFAULT 0,
    "balanceUtilization" DOUBLE PRECISION,
    "dustBalance" DOUBLE PRECISION,
    "executionQuality" DOUBLE PRECISION,
    "metadata" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutionStatistics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionHistory" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION,
    "entryPrice" DOUBLE PRECISION,
    "markPrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION,
    "unrealizedPnl" DOUBLE PRECISION,
    "currentValue" DOUBLE PRECISION,
    "holdingMinutes" DOUBLE PRECISION,
    "highestPrice" DOUBLE PRECISION,
    "lowestPrice" DOUBLE PRECISION,
    "payload" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PositionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "totalValueQuote" DOUBLE PRECISION,
    "availableQuote" DOUBLE PRECISION,
    "lockedQuote" DOUBLE PRECISION,
    "positions" JSONB,
    "allocations" JSONB,
    "metadata" JSONB,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalAllocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT,
    "asset" TEXT NOT NULL,
    "allocatedPct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "allocatedAmount" DOUBLE PRECISION,
    "mode" TEXT NOT NULL DEFAULT 'ALL_IN',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CapitalAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionMgmtJobState" (
    "id" TEXT NOT NULL,
    "jobType" "ExecutionMgmtJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutionMgmtJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PositionSizing_symbol_createdAt_idx" ON "PositionSizing"("symbol", "createdAt");
CREATE INDEX "PositionSizing_executionId_idx" ON "PositionSizing"("executionId");
CREATE INDEX "ExecutionValidation_executionId_idx" ON "ExecutionValidation"("executionId");
CREATE INDEX "ExecutionValidation_symbol_validatedAt_idx" ON "ExecutionValidation"("symbol", "validatedAt");
CREATE INDEX "ExecutionReplay_executionId_idx" ON "ExecutionReplay"("executionId");
CREATE INDEX "ExecutionReplay_symbol_replayedAt_idx" ON "ExecutionReplay"("symbol", "replayedAt");
CREATE INDEX "ExecutionStatistics_periodEnd_mode_idx" ON "ExecutionStatistics"("periodEnd", "mode");
CREATE INDEX "PositionHistory_positionId_recordedAt_idx" ON "PositionHistory"("positionId", "recordedAt");
CREATE INDEX "PositionHistory_userId_symbol_recordedAt_idx" ON "PositionHistory"("userId", "symbol", "recordedAt");
CREATE INDEX "PortfolioSnapshot_userId_snapshotAt_idx" ON "PortfolioSnapshot"("userId", "snapshotAt");
CREATE INDEX "PortfolioSnapshot_mode_snapshotAt_idx" ON "PortfolioSnapshot"("mode", "snapshotAt");
CREATE INDEX "CapitalAllocation_userId_asset_idx" ON "CapitalAllocation"("userId", "asset");
CREATE UNIQUE INDEX "ExecutionMgmtJobState_jobType_key" ON "ExecutionMgmtJobState"("jobType");
