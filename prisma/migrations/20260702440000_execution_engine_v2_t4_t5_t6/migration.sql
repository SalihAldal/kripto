-- Execution Engine V2 (Sprint 4: T4/T5/T6)

CREATE TYPE "ExecutionEngineV2JobType" AS ENUM ('ENTRY_EVALUATE', 'EXIT_EVALUATE', 'EXECUTE_ORDER', 'VERIFY_ORDER', 'RECONCILE', 'RECOVERY', 'WAIT_REEVALUATE', 'HOLD_REEVALUATE');
CREATE TYPE "ExecutionLogStatus" AS ENUM ('PENDING', 'SUBMITTED', 'FILLED', 'PARTIALLY_FILLED', 'REJECTED', 'FAILED', 'CANCELLED', 'VERIFIED');
CREATE TYPE "ExecutionReconciliationStatus" AS ENUM ('MATCHED', 'MISMATCH', 'REPAIRED', 'FAILED');

CREATE TABLE "ExecutionLog" (
  "id" TEXT NOT NULL,
  "logKey" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "userId" TEXT,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "orderType" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "quoteSpend" DOUBLE PRECISION,
  "requestedPrice" DOUBLE PRECISION,
  "averageFillPrice" DOUBLE PRECISION,
  "filledQuantity" DOUBLE PRECISION,
  "fee" DOUBLE PRECISION,
  "slippagePct" DOUBLE PRECISION,
  "status" "ExecutionLogStatus" NOT NULL DEFAULT 'PENDING',
  "latencyMs" DOUBLE PRECISION,
  "idempotencyKey" TEXT,
  "entryAnalysisId" TEXT,
  "exitAnalysisId" TEXT,
  "riskApproved" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verifiedAt" TIMESTAMP(3),
  CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutionReconciliation" (
  "id" TEXT NOT NULL,
  "reconcileKey" TEXT NOT NULL,
  "executionId" TEXT,
  "symbol" TEXT NOT NULL,
  "side" TEXT,
  "internalQty" DOUBLE PRECISION,
  "exchangeQty" DOUBLE PRECISION,
  "internalBalance" DOUBLE PRECISION,
  "exchangeBalance" DOUBLE PRECISION,
  "status" "ExecutionReconciliationStatus" NOT NULL DEFAULT 'MISMATCH',
  "mismatchReason" TEXT,
  "repairAction" TEXT,
  "metadata" JSONB,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionReconciliation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutionEngineV2JobState" (
  "id" TEXT NOT NULL,
  "jobType" "ExecutionEngineV2JobType" NOT NULL,
  "lastProcessedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionEngineV2JobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExecutionLog_logKey_key" ON "ExecutionLog"("logKey");
CREATE INDEX "ExecutionLog_executionId_idx" ON "ExecutionLog"("executionId");
CREATE INDEX "ExecutionLog_symbol_submittedAt_idx" ON "ExecutionLog"("symbol", "submittedAt");
CREATE INDEX "ExecutionLog_status_submittedAt_idx" ON "ExecutionLog"("status", "submittedAt");
CREATE INDEX "ExecutionLog_idempotencyKey_idx" ON "ExecutionLog"("idempotencyKey");

CREATE UNIQUE INDEX "ExecutionReconciliation_reconcileKey_key" ON "ExecutionReconciliation"("reconcileKey");
CREATE INDEX "ExecutionReconciliation_symbol_reconciledAt_idx" ON "ExecutionReconciliation"("symbol", "reconciledAt");
CREATE INDEX "ExecutionReconciliation_status_reconciledAt_idx" ON "ExecutionReconciliation"("status", "reconciledAt");
CREATE INDEX "ExecutionReconciliation_executionId_idx" ON "ExecutionReconciliation"("executionId");

CREATE UNIQUE INDEX "ExecutionEngineV2JobState_jobType_key" ON "ExecutionEngineV2JobState"("jobType");
