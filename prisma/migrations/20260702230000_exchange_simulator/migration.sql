-- CreateEnum
CREATE TYPE "SimulatedOrderType" AS ENUM ('MARKET', 'LIMIT', 'STOP_LIMIT', 'STOP_MARKET');

-- CreateEnum
CREATE TYPE "ExchangeSimulatorJobType" AS ENUM ('EXECUTION_SIMULATE', 'EXECUTION_REPLAY', 'SLIPPAGE_CALCULATE', 'LATENCY_ANALYZE', 'FEE_CALCULATE');

-- CreateTable
CREATE TABLE "ExecutionSimulation" (
    "id" TEXT NOT NULL,
    "executionId" TEXT,
    "userId" TEXT,
    "orderId" TEXT,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'BINANCE_TR',
    "side" TEXT NOT NULL,
    "orderType" "SimulatedOrderType" NOT NULL DEFAULT 'MARKET',
    "requestedQty" DOUBLE PRECISION,
    "executedQty" DOUBLE PRECISION,
    "requestedPrice" DOUBLE PRECISION,
    "avgFillPrice" DOUBLE PRECISION,
    "remainingQty" DOUBLE PRECISION,
    "fillCount" INTEGER NOT NULL DEFAULT 1,
    "totalFees" DOUBLE PRECISION,
    "totalSlippagePct" DOUBLE PRECISION,
    "executionDurationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'FILLED',
    "metadata" JSONB,
    "simulatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionFill" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "fillIndex" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "notional" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION,
    "slippagePct" DOUBLE PRECISION,
    "filledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLatency" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "networkMs" DOUBLE PRECISION,
    "exchangeMs" DOUBLE PRECISION,
    "queueMs" DOUBLE PRECISION,
    "matchingMs" DOUBLE PRECISION,
    "totalMs" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLatency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionQuality" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION,
    "slippageScore" DOUBLE PRECISION,
    "liquidityScore" DOUBLE PRECISION,
    "spreadScore" DOUBLE PRECISION,
    "fillScore" DOUBLE PRECISION,
    "latencyScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionQuality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionSlippage" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "slippagePct" DOUBLE PRECISION,
    "slippageBps" DOUBLE PRECISION,
    "bestPrice" DOUBLE PRECISION,
    "worstPrice" DOUBLE PRECISION,
    "midPrice" DOUBLE PRECISION,
    "spreadPct" DOUBLE PRECISION,
    "impactPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionSlippage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionFee" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "fillIndex" INTEGER,
    "feeType" TEXT NOT NULL DEFAULT 'TAKER',
    "feeRate" DOUBLE PRECISION,
    "feeAmount" DOUBLE PRECISION,
    "notional" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionComparison" (
    "id" TEXT NOT NULL,
    "simulationId" TEXT NOT NULL,
    "requestedPrice" DOUBLE PRECISION,
    "executedPrice" DOUBLE PRECISION,
    "bestPossiblePrice" DOUBLE PRECISION,
    "worstPossiblePrice" DOUBLE PRECISION,
    "slippagePct" DOUBLE PRECISION,
    "fees" DOUBLE PRECISION,
    "executionTimeMs" INTEGER,
    "improvementBps" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeSimulatorJobState" (
    "id" TEXT NOT NULL,
    "jobType" "ExchangeSimulatorJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeSimulatorJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutionSimulation_executionId_idx" ON "ExecutionSimulation"("executionId");

-- CreateIndex
CREATE INDEX "ExecutionSimulation_symbol_simulatedAt_idx" ON "ExecutionSimulation"("symbol", "simulatedAt");

-- CreateIndex
CREATE INDEX "ExecutionSimulation_userId_simulatedAt_idx" ON "ExecutionSimulation"("userId", "simulatedAt");

-- CreateIndex
CREATE INDEX "ExecutionFill_simulationId_fillIndex_idx" ON "ExecutionFill"("simulationId", "fillIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionLatency_simulationId_key" ON "ExecutionLatency"("simulationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionQuality_simulationId_key" ON "ExecutionQuality"("simulationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionSlippage_simulationId_key" ON "ExecutionSlippage"("simulationId");

-- CreateIndex
CREATE INDEX "ExecutionFee_simulationId_fillIndex_idx" ON "ExecutionFee"("simulationId", "fillIndex");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionComparison_simulationId_key" ON "ExecutionComparison"("simulationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeSimulatorJobState_jobType_key" ON "ExchangeSimulatorJobState"("jobType");

-- AddForeignKey
ALTER TABLE "ExecutionFill" ADD CONSTRAINT "ExecutionFill_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "ExecutionSimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionLatency" ADD CONSTRAINT "ExecutionLatency_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "ExecutionSimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionQuality" ADD CONSTRAINT "ExecutionQuality_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "ExecutionSimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionSlippage" ADD CONSTRAINT "ExecutionSlippage_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "ExecutionSimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionFee" ADD CONSTRAINT "ExecutionFee_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "ExecutionSimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionComparison" ADD CONSTRAINT "ExecutionComparison_simulationId_fkey" FOREIGN KEY ("simulationId") REFERENCES "ExecutionSimulation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
