-- CreateEnum
CREATE TYPE "PaperValidationJobType" AS ENUM ('SYNC_PORTFOLIO', 'RECORD_TRADES', 'CALCULATE_METRICS', 'COIN_RANKING', 'SESSION_ANALYSIS', 'MISSED_OPPORTUNITY', 'ACCURACY_CHECK', 'RISK_VALIDATION', 'READINESS_SCORE', 'DAILY_REPORT');

-- CreateEnum
CREATE TYPE "PaperTradeStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaperTradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "LiveReadinessStatus" AS ENUM ('NOT_READY', 'APPROACHING', 'READY', 'RECOMMENDED');

-- CreateEnum
CREATE TYPE "MissedOpportunityCategory" AS ENUM ('REJECTED', 'IGNORED', 'LATE_ENTRY', 'EARLY_EXIT', 'LATE_EXIT', 'FALSE_POSITIVE', 'FALSE_NEGATIVE');

-- CreateTable
CREATE TABLE "PaperPortfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lockedBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSlippage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unrealizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "tradeKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "PaperTradeSide" NOT NULL,
    "status" "PaperTradeStatus" NOT NULL DEFAULT 'OPEN',
    "strategy" TEXT,
    "marketRegime" TEXT,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION NOT NULL,
    "avgEntryPrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "returnPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slippagePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holdSec" INTEGER,
    "decisionId" TEXT,
    "executionId" TEXT,
    "positionId" TEXT,
    "simulationId" TEXT,
    "tradeQualityScore" DOUBLE PRECISION,
    "entryScore" DOUBLE PRECISION,
    "exitScore" DOUBLE PRECISION,
    "executionScore" DOUBLE PRECISION,
    "decisionScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "overallScore" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperExecution" (
    "id" TEXT NOT NULL,
    "executionKey" TEXT NOT NULL,
    "paperTradeId" TEXT NOT NULL,
    "simulationId" TEXT,
    "executionId" TEXT,
    "side" TEXT NOT NULL,
    "requestedQty" DOUBLE PRECISION,
    "executedQty" DOUBLE PRECISION NOT NULL,
    "requestedPrice" DOUBLE PRECISION,
    "avgFillPrice" DOUBLE PRECISION NOT NULL,
    "spreadPct" DOUBLE PRECISION,
    "slippagePct" DOUBLE PRECISION,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "fillCount" INTEGER NOT NULL DEFAULT 1,
    "bidPrice" DOUBLE PRECISION,
    "askPrice" DOUBLE PRECISION,
    "depthUsed" DOUBLE PRECISION,
    "expectedFillPrice" DOUBLE PRECISION,
    "fillAccuracyPct" DOUBLE PRECISION,
    "priceDifference" DOUBLE PRECISION,
    "latencyDifferenceMs" INTEGER,
    "metadata" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperMetrics" (
    "id" TEXT NOT NULL,
    "paperTradeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "avgHoldSec" DOUBLE PRECISION,
    "metrics" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPaperReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "avgHoldSec" DOUBLE PRECISION,
    "avgProfit" DOUBLE PRECISION,
    "avgLoss" DOUBLE PRECISION,
    "totalFees" DOUBLE PRECISION,
    "totalSlippage" DOUBLE PRECISION,
    "bestCoin" TEXT,
    "worstCoin" TEXT,
    "bestStrategy" TEXT,
    "worstStrategy" TEXT,
    "bestRegime" TEXT,
    "worstRegime" TEXT,
    "content" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyPaperReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoinPerformance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION,
    "avgReturn" DOUBLE PRECISION,
    "avgHoldSec" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "avgSlippage" DOUBLE PRECISION,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionPerformance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL,
    "marketRegime" TEXT,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION,
    "avgReturn" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveReadiness" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "readinessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "LiveReadinessStatus" NOT NULL DEFAULT 'NOT_READY',
    "minTradesMet" BOOLEAN NOT NULL DEFAULT false,
    "minProfitFactorMet" BOOLEAN NOT NULL DEFAULT false,
    "minWinRateMet" BOOLEAN NOT NULL DEFAULT false,
    "maxDrawdownMet" BOOLEAN NOT NULL DEFAULT false,
    "dataQualityMet" BOOLEAN NOT NULL DEFAULT false,
    "executionQualityMet" BOOLEAN NOT NULL DEFAULT false,
    "replayIntegrityMet" BOOLEAN NOT NULL DEFAULT false,
    "recommendation" TEXT,
    "expectedImprovement" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "evidence" JSONB,
    "blockers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveReadiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperMissedOpportunity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT,
    "symbol" TEXT NOT NULL,
    "category" "MissedOpportunityCategory" NOT NULL,
    "baselineReturnPct" DOUBLE PRECISION,
    "potentialReturnPct" DOUBLE PRECISION,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperMissedOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperValidationJobState" (
    "id" TEXT NOT NULL,
    "jobType" "PaperValidationJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperValidationJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperPortfolio_userId_key" ON "PaperPortfolio"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperTrade_tradeKey_key" ON "PaperTrade"("tradeKey");

-- CreateIndex
CREATE INDEX "PaperTrade_userId_status_openedAt_idx" ON "PaperTrade"("userId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "PaperTrade_symbol_openedAt_idx" ON "PaperTrade"("symbol", "openedAt");

-- CreateIndex
CREATE INDEX "PaperTrade_decisionId_idx" ON "PaperTrade"("decisionId");

-- CreateIndex
CREATE INDEX "PaperTrade_positionId_idx" ON "PaperTrade"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperExecution_executionKey_key" ON "PaperExecution"("executionKey");

-- CreateIndex
CREATE INDEX "PaperExecution_paperTradeId_executedAt_idx" ON "PaperExecution"("paperTradeId", "executedAt");

-- CreateIndex
CREATE INDEX "PaperExecution_simulationId_idx" ON "PaperExecution"("simulationId");

-- CreateIndex
CREATE INDEX "PaperExecution_executionId_idx" ON "PaperExecution"("executionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperMetrics_paperTradeId_key" ON "PaperMetrics"("paperTradeId");

-- CreateIndex
CREATE INDEX "PaperMetrics_userId_computedAt_idx" ON "PaperMetrics"("userId", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPaperReport_userId_reportDate_key" ON "DailyPaperReport"("userId", "reportDate");

-- CreateIndex
CREATE INDEX "DailyPaperReport_reportDate_idx" ON "DailyPaperReport"("reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "CoinPerformance_userId_symbol_key" ON "CoinPerformance"("userId", "symbol");

-- CreateIndex
CREATE INDEX "CoinPerformance_userId_winRate_idx" ON "CoinPerformance"("userId", "winRate");

-- CreateIndex
CREATE UNIQUE INDEX "SessionPerformance_userId_sessionType_marketRegime_key" ON "SessionPerformance"("userId", "sessionType", "marketRegime");

-- CreateIndex
CREATE INDEX "SessionPerformance_userId_sessionType_idx" ON "SessionPerformance"("userId", "sessionType");

-- CreateIndex
CREATE UNIQUE INDEX "LiveReadiness_userId_reportDate_key" ON "LiveReadiness"("userId", "reportDate");

-- CreateIndex
CREATE INDEX "LiveReadiness_readinessScore_reportDate_idx" ON "LiveReadiness"("readinessScore", "reportDate");

-- CreateIndex
CREATE INDEX "PaperMissedOpportunity_userId_category_createdAt_idx" ON "PaperMissedOpportunity"("userId", "category", "createdAt");

-- CreateIndex
CREATE INDEX "PaperMissedOpportunity_decisionId_idx" ON "PaperMissedOpportunity"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperValidationJobState_jobType_key" ON "PaperValidationJobState"("jobType");

-- CreateIndex
CREATE INDEX "PaperPortfolio_updatedAt_idx" ON "PaperPortfolio"("updatedAt");

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "PaperPortfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperExecution" ADD CONSTRAINT "PaperExecution_paperTradeId_fkey" FOREIGN KEY ("paperTradeId") REFERENCES "PaperTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperMetrics" ADD CONSTRAINT "PaperMetrics_paperTradeId_fkey" FOREIGN KEY ("paperTradeId") REFERENCES "PaperTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
