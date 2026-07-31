-- CreateTable
CREATE TABLE "TradeLifecycleEvent" (
    "id" TEXT NOT NULL,
    "executionId" TEXT,
    "symbol" TEXT,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "level" TEXT,
    "message" TEXT NOT NULL,
    "orderId" TEXT,
    "positionId" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeLifecycleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradeLifecycleEvent_createdAt_idx" ON "TradeLifecycleEvent"("createdAt");

-- CreateIndex
CREATE INDEX "TradeLifecycleEvent_executionId_createdAt_idx" ON "TradeLifecycleEvent"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "TradeLifecycleEvent_symbol_createdAt_idx" ON "TradeLifecycleEvent"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "TradeLifecycleEvent_orderId_createdAt_idx" ON "TradeLifecycleEvent"("orderId", "createdAt");
