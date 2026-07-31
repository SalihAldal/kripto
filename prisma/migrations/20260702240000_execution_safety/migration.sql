-- CreateEnum
CREATE TYPE "SafetyValidationStage" AS ENUM ('BALANCE', 'PRICE', 'MARKET', 'DUPLICATE', 'POSITION', 'API', 'EXCHANGE', 'ORDER', 'SAFETY', 'QUANTITY');

-- CreateEnum
CREATE TYPE "SafetyDecisionOutcome" AS ENUM ('ALLOW', 'BLOCK');

-- CreateEnum
CREATE TYPE "EmergencyActionType" AS ENUM ('EMERGENCY_STOP', 'GLOBAL_KILL', 'EXCHANGE_KILL', 'SYMBOL_KILL', 'AUTO_PAUSE', 'MANUAL_PAUSE');

-- CreateEnum
CREATE TYPE "ExecutionSafetyJobType" AS ENUM ('EXECUTION_VALIDATE', 'EXCHANGE_HEALTH_MONITOR', 'API_HEALTH_CHECK', 'RECOVERY_PROCESS', 'EMERGENCY_MONITOR', 'DUPLICATE_DETECT');

-- CreateTable
CREATE TABLE "ExecutionSafety" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'live',
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "blockedBy" TEXT,
    "rejectReason" TEXT,
    "safetyScore" DOUBLE PRECISION,
    "exchangeHealthScore" DOUBLE PRECISION,
    "orderConfidence" DOUBLE PRECISION,
    "validationQuality" DOUBLE PRECISION,
    "executionReadiness" DOUBLE PRECISION,
    "stageCount" INTEGER NOT NULL DEFAULT 0,
    "failedStageCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "stages" JSONB,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionSafety_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionSafetyValidation" (
    "id" TEXT NOT NULL,
    "safetyId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "stage" "SafetyValidationStage" NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "reasons" JSONB,
    "metadata" JSONB,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionSafetyValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionAudit" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "userId" TEXT,
    "symbol" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB,
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionFailure" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "userId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "stage" TEXT,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryEvent" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "userId" TEXT,
    "symbol" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "reason" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RecoveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeHealth" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'BINANCE_TR',
    "healthy" BOOLEAN NOT NULL DEFAULT true,
    "latencyMs" DOUBLE PRECISION,
    "errorRate" DOUBLE PRECISION,
    "openCircuits" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyDecision" (
    "id" TEXT NOT NULL,
    "safetyId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "outcome" "SafetyDecisionOutcome" NOT NULL,
    "safetyScore" DOUBLE PRECISION,
    "orderConfidence" DOUBLE PRECISION,
    "executionReadiness" DOUBLE PRECISION,
    "rejectReason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SafetyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyAction" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "userId" TEXT,
    "symbol" TEXT,
    "actionType" "EmergencyActionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmergencyAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionSafetyJobState" (
    "id" TEXT NOT NULL,
    "jobType" "ExecutionSafetyJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionSafetyJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionSafety_executionId_idx" ON "ExecutionSafety"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionSafety_userId_validatedAt_idx" ON "ExecutionSafety"("userId", "validatedAt");

-- CreateIndex
CREATE INDEX "ExecutionSafety_symbol_validatedAt_idx" ON "ExecutionSafety"("symbol", "validatedAt");

-- CreateIndex
CREATE INDEX "ExecutionSafetyValidation_executionId_validatedAt_idx" ON "ExecutionSafetyValidation"("executionId", "validatedAt");

-- CreateIndex
CREATE INDEX "ExecutionSafetyValidation_safetyId_stage_idx" ON "ExecutionSafetyValidation"("safetyId", "stage");

-- CreateIndex
CREATE INDEX "ExecutionAudit_executionId_idx" ON "ExecutionAudit"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionAudit_symbol_auditedAt_idx" ON "ExecutionAudit"("symbol", "auditedAt");

-- CreateIndex
CREATE INDEX "ExecutionFailure_executionId_idx" ON "ExecutionFailure"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionFailure_symbol_failedAt_idx" ON "ExecutionFailure"("symbol", "failedAt");

-- CreateIndex
CREATE INDEX "RecoveryEvent_executionId_idx" ON "RecoveryEvent"("executionId");

-- CreateIndex
CREATE INDEX "RecoveryEvent_status_startedAt_idx" ON "RecoveryEvent"("status", "startedAt");

-- CreateIndex
CREATE INDEX "ExchangeHealth_exchange_checkedAt_idx" ON "ExchangeHealth"("exchange", "checkedAt");

-- CreateIndex
CREATE INDEX "SafetyDecision_executionId_idx" ON "SafetyDecision"("executionId");

-- CreateIndex
CREATE INDEX "SafetyDecision_userId_decidedAt_idx" ON "SafetyDecision"("userId", "decidedAt");

-- CreateIndex
CREATE INDEX "EmergencyAction_scope_createdAt_idx" ON "EmergencyAction"("scope", "createdAt");

-- CreateIndex
CREATE INDEX "EmergencyAction_symbol_createdAt_idx" ON "EmergencyAction"("symbol", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionSafetyJobState_jobType_key" ON "ExecutionSafetyJobState"("jobType");

-- AddForeignKey
ALTER TABLE "ExecutionSafetyValidation" ADD CONSTRAINT "ExecutionSafetyValidation_safetyId_fkey" FOREIGN KEY ("safetyId") REFERENCES "ExecutionSafety"("id") ON DELETE CASCADE ON UPDATE CASCADE;
