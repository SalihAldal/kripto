-- CreateTable
CREATE TABLE "AutoRoundJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalRounds" INTEGER NOT NULL,
    "completedRounds" INTEGER NOT NULL DEFAULT 0,
    "failedRounds" INTEGER NOT NULL DEFAULT 0,
    "currentRound" INTEGER NOT NULL DEFAULT 0,
    "budgetPerTrade" DOUBLE PRECISION NOT NULL,
    "targetProfitPct" DOUBLE PRECISION NOT NULL,
    "stopLossPct" DOUBLE PRECISION NOT NULL,
    "maxWaitSec" INTEGER NOT NULL,
    "coinSelectionMode" TEXT NOT NULL DEFAULT 'scanner_best',
    "aiMode" TEXT NOT NULL DEFAULT 'consensus',
    "allowRepeatCoin" BOOLEAN NOT NULL DEFAULT true,
    "mode" TEXT NOT NULL DEFAULT 'auto',
    "activeState" TEXT NOT NULL DEFAULT 'bekliyor',
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoRoundJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoRoundRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "symbol" TEXT,
    "executionId" TEXT,
    "selectedReason" TEXT,
    "buyPrice" DOUBLE PRECISION,
    "buyQty" DOUBLE PRECISION,
    "sellPrice" DOUBLE PRECISION,
    "sellQty" DOUBLE PRECISION,
    "netPnl" DOUBLE PRECISION,
    "feeTotal" DOUBLE PRECISION,
    "result" TEXT,
    "failReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoRoundRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutoRoundJob_userId_createdAt_idx" ON "AutoRoundJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AutoRoundJob_status_createdAt_idx" ON "AutoRoundJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutoRoundRun_jobId_roundNo_idx" ON "AutoRoundRun"("jobId", "roundNo");

-- CreateIndex
CREATE INDEX "AutoRoundRun_state_createdAt_idx" ON "AutoRoundRun"("state", "createdAt");

-- AddForeignKey
ALTER TABLE "AutoRoundJob" ADD CONSTRAINT "AutoRoundJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoRoundRun" ADD CONSTRAINT "AutoRoundRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AutoRoundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
