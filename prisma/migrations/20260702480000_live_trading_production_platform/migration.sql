-- CreateEnum
CREATE TYPE "LiveTradingJobType" AS ENUM ('HEALTH_MONITOR', 'POSITION_RECOVERY', 'RECONCILIATION', 'EXECUTION_AUDIT', 'ALERT_DISPATCH', 'CIRCUIT_BREAKER_CHECK', 'KILL_SWITCH_MONITOR', 'PRODUCTION_REPORT', 'GO_LIVE_VALIDATE');

-- CreateEnum
CREATE TYPE "LiveTradeStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'RECOVERED');

-- CreateEnum
CREATE TYPE "CircuitBreakerReason" AS ENUM ('EXCHANGE_UNAVAILABLE', 'DATABASE_UNAVAILABLE', 'RISK_ENGINE_FAILURE', 'DECISION_ENGINE_FAILURE', 'FEATURE_SNAPSHOT_FAILURE', 'REPLAY_FAILURE', 'MODEL_UNAVAILABLE', 'PREDICTION_CONFIDENCE_UNAVAILABLE', 'EXECUTION_FAILURE_THRESHOLD', 'BALANCE_MISMATCH', 'PORTFOLIO_MISMATCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "KillSwitchSource" AS ENUM ('MANUAL', 'AUTOMATIC', 'API', 'DASHBOARD', 'TELEGRAM', 'CIRCUIT_BREAKER');

-- CreateEnum
CREATE TYPE "LiveAlertChannel" AS ENUM ('TELEGRAM', 'DISCORD', 'SLACK', 'WEBHOOK', 'EMAIL');

-- CreateEnum
CREATE TYPE "LiveAlertSeverity" AS ENUM ('INFO', 'WARN', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ProductionReportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "LiveTrade" (
    "id" TEXT NOT NULL,
    "tradeKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "status" "LiveTradeStatus" NOT NULL DEFAULT 'OPEN',
    "strategy" TEXT,
    "marketRegime" TEXT,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION NOT NULL,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "returnPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fees" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slippagePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "holdSec" INTEGER,
    "decisionId" TEXT,
    "executionId" TEXT,
    "positionId" TEXT,
    "modelVersion" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveExecution" (
    "id" TEXT NOT NULL,
    "executionKey" TEXT NOT NULL,
    "liveTradeId" TEXT,
    "userId" TEXT NOT NULL,
    "executionId" TEXT,
    "logKey" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "orderRequest" JSONB,
    "exchangeResponse" JSONB,
    "requestedQty" DOUBLE PRECISION,
    "executedQty" DOUBLE PRECISION NOT NULL,
    "requestedPrice" DOUBLE PRECISION,
    "fillPrice" DOUBLE PRECISION NOT NULL,
    "commission" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "slippagePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "executionConfidence" DOUBLE PRECISION,
    "executionResult" TEXT NOT NULL DEFAULT 'FILLED',
    "metadata" JSONB,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveExecutionAudit" (
    "id" TEXT NOT NULL,
    "liveExecutionId" TEXT NOT NULL,
    "orderRequest" JSONB,
    "exchangeResponse" JSONB,
    "latencyMs" INTEGER,
    "fillPrice" DOUBLE PRECISION,
    "commission" DOUBLE PRECISION,
    "slippagePct" DOUBLE PRECISION,
    "executionResult" TEXT,
    "executionConfidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveExecutionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CircuitBreakerEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "reason" "CircuitBreakerReason" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "message" TEXT,
    "evidence" JSONB,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "CircuitBreakerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KillSwitchEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "source" "KillSwitchSource" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT NOT NULL,
    "triggeredBy" TEXT,
    "evidence" JSONB,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "KillSwitchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionHealth" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "exchangeLatencyMs" DOUBLE PRECISION,
    "restLatencyMs" DOUBLE PRECISION,
    "wsLatencyMs" DOUBLE PRECISION,
    "predictionLatencyMs" DOUBLE PRECISION,
    "executionLatencyMs" DOUBLE PRECISION,
    "queueHealthy" BOOLEAN NOT NULL DEFAULT true,
    "databaseHealthy" BOOLEAN NOT NULL DEFAULT true,
    "workersHealthy" BOOLEAN NOT NULL DEFAULT true,
    "exchangeHealthy" BOOLEAN NOT NULL DEFAULT true,
    "timeSyncHealthy" BOOLEAN NOT NULL DEFAULT true,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapitalProtection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dailyPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyTradeCount" INT NOT NULL DEFAULT 0,
    "consecutiveLosses" INT NOT NULL DEFAULT 0,
    "openPositionCount" INT NOT NULL DEFAULT 0,
    "totalExposure" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxCoinExposure" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyLossLimitPct" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "maxDailyTrades" INT NOT NULL DEFAULT 50,
    "maxOpenPositions" INT NOT NULL DEFAULT 5,
    "maxPositionSizePct" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "maxExposurePct" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "maxCoinExposurePct" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "maxConsecutiveLosses" INT NOT NULL DEFAULT 5,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CapitalProtection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "LiveAlertChannel" NOT NULL,
    "severity" "LiveAlertSeverity" NOT NULL DEFAULT 'INFO',
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "deliveredAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cadence" "ProductionReportCadence" NOT NULL,
    "reportDate" DATE NOT NULL,
    "tradeCount" INT NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION,
    "profitFactor" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "dailyPnl" DOUBLE PRECISION,
    "weeklyPnl" DOUBLE PRECISION,
    "monthlyPnl" DOUBLE PRECISION,
    "maxDrawdown" DOUBLE PRECISION,
    "content" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveTradingJobState" (
    "id" TEXT NOT NULL,
    "jobType" "LiveTradingJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveTradingJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveTrade_tradeKey_key" ON "LiveTrade"("tradeKey");

-- CreateIndex
CREATE INDEX "LiveTrade_userId_status_openedAt_idx" ON "LiveTrade"("userId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "LiveTrade_symbol_openedAt_idx" ON "LiveTrade"("symbol", "openedAt");

-- CreateIndex
CREATE INDEX "LiveTrade_executionId_idx" ON "LiveTrade"("executionId");

-- CreateIndex
CREATE INDEX "LiveTrade_positionId_idx" ON "LiveTrade"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "LiveExecution_executionKey_key" ON "LiveExecution"("executionKey");

-- CreateIndex
CREATE INDEX "LiveExecution_userId_executedAt_idx" ON "LiveExecution"("userId", "executedAt");

-- CreateIndex
CREATE INDEX "LiveExecution_executionId_idx" ON "LiveExecution"("executionId");

-- CreateIndex
CREATE INDEX "LiveExecution_symbol_executedAt_idx" ON "LiveExecution"("symbol", "executedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveExecutionAudit_liveExecutionId_key" ON "LiveExecutionAudit"("liveExecutionId");

-- CreateIndex
CREATE INDEX "LiveExecutionAudit_auditedAt_idx" ON "LiveExecutionAudit"("auditedAt");

-- CreateIndex
CREATE INDEX "CircuitBreakerEvent_active_triggeredAt_idx" ON "CircuitBreakerEvent"("active", "triggeredAt");

-- CreateIndex
CREATE INDEX "CircuitBreakerEvent_userId_reason_idx" ON "CircuitBreakerEvent"("userId", "reason");

-- CreateIndex
CREATE INDEX "KillSwitchEvent_active_triggeredAt_idx" ON "KillSwitchEvent"("active", "triggeredAt");

-- CreateIndex
CREATE INDEX "KillSwitchEvent_userId_source_idx" ON "KillSwitchEvent"("userId", "source");

-- CreateIndex
CREATE INDEX "ProductionHealth_recordedAt_idx" ON "ProductionHealth"("recordedAt");

-- CreateIndex
CREATE INDEX "ProductionHealth_userId_recordedAt_idx" ON "ProductionHealth"("userId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CapitalProtection_userId_key" ON "CapitalProtection"("userId");

-- CreateIndex
CREATE INDEX "CapitalProtection_blocked_updatedAt_idx" ON "CapitalProtection"("blocked", "updatedAt");

-- CreateIndex
CREATE INDEX "LiveAlert_userId_createdAt_idx" ON "LiveAlert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveAlert_eventType_severity_idx" ON "LiveAlert"("eventType", "severity");

-- CreateIndex
CREATE INDEX "LiveAlert_delivered_createdAt_idx" ON "LiveAlert"("delivered", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionReport_userId_cadence_reportDate_key" ON "ProductionReport"("userId", "cadence", "reportDate");

-- CreateIndex
CREATE INDEX "ProductionReport_reportDate_idx" ON "ProductionReport"("reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "LiveTradingJobState_jobType_key" ON "LiveTradingJobState"("jobType");

-- AddForeignKey
ALTER TABLE "LiveExecution" ADD CONSTRAINT "LiveExecution_liveTradeId_fkey" FOREIGN KEY ("liveTradeId") REFERENCES "LiveTrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveExecutionAudit" ADD CONSTRAINT "LiveExecutionAudit_liveExecutionId_fkey" FOREIGN KEY ("liveExecutionId") REFERENCES "LiveExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
