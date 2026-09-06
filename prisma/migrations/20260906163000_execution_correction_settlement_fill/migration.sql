-- CreateTable
CREATE TABLE "PositionSettlementFill" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "settlementFillId" TEXT NOT NULL,
    "tradeOrderId" TEXT,
    "executedQty" DOUBLE PRECISION NOT NULL,
    "fillPrice" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeAsset" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionSettlementFill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PositionSettlementFill_positionId_settlementFillId_key" ON "PositionSettlementFill"("positionId", "settlementFillId");

-- CreateIndex
CREATE INDEX "PositionSettlementFill_positionId_createdAt_idx" ON "PositionSettlementFill"("positionId", "createdAt");

-- AddForeignKey
ALTER TABLE "PositionSettlementFill" ADD CONSTRAINT "PositionSettlementFill_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
