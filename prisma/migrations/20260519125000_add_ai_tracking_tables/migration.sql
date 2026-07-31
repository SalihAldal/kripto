-- AI performance memory + trade event log + position tracking

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiPerformanceResult') THEN
    CREATE TYPE "AiPerformanceResult" AS ENUM ('SUCCESS', 'FAILED', 'PARTIAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AiPerformanceMemory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "aiName" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "predictedDirection" TEXT NOT NULL,
  "predictedPercent" DOUBLE PRECISION NOT NULL,
  "predictedRangeMin" DOUBLE PRECISION,
  "predictedRangeMax" DOUBLE PRECISION,
  "confidenceScore" DOUBLE PRECISION NOT NULL,
  "entryPrice" DOUBLE PRECISION NOT NULL,
  "horizonMinutes" INTEGER NOT NULL,
  "actualMoveAfterTime" DOUBLE PRECISION,
  "result" "AiPerformanceResult",
  "errorPercent" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "evaluatedAt" TIMESTAMP(3),

  CONSTRAINT "AiPerformanceMemory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AiPerformanceMemory"
  ADD CONSTRAINT "AiPerformanceMemory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "AiPerformanceMemory_userId_aiName_createdAt_idx"
  ON "AiPerformanceMemory"("userId", "aiName", "createdAt");
CREATE INDEX IF NOT EXISTS "AiPerformanceMemory_symbol_createdAt_idx"
  ON "AiPerformanceMemory"("symbol", "createdAt");

CREATE TABLE IF NOT EXISTS "TradeEventLog" (
  "id" TEXT NOT NULL,
  "positionId" TEXT,
  "symbol" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "reason" TEXT,
  "aiConfidence" DOUBLE PRECISION,
  "price" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TradeEventLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TradeEventLog_positionId_createdAt_idx"
  ON "TradeEventLog"("positionId", "createdAt");
CREATE INDEX IF NOT EXISTS "TradeEventLog_symbol_createdAt_idx"
  ON "TradeEventLog"("symbol", "createdAt");
CREATE INDEX IF NOT EXISTS "TradeEventLog_eventType_createdAt_idx"
  ON "TradeEventLog"("eventType", "createdAt");

CREATE TABLE IF NOT EXISTS "PositionTracking" (
  "id" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "buyPrice" DOUBLE PRECISION NOT NULL,
  "currentPrice" DOUBLE PRECISION,
  "highestPriceAfterBuy" DOUBLE PRECISION,
  "targetSellPrice" DOUBLE PRECISION,
  "activeStopPrice" DOUBLE PRECISION,
  "trailingActive" BOOLEAN NOT NULL DEFAULT false,
  "profitPercent" DOUBLE PRECISION,
  "aiLastDecision" TEXT,
  "lastAnalysisAt" TIMESTAMP(3),
  "positionStatus" TEXT NOT NULL DEFAULT 'OPEN',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PositionTracking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PositionTracking_positionId_key" ON "PositionTracking"("positionId");
CREATE INDEX IF NOT EXISTS "PositionTracking_symbol_updatedAt_idx" ON "PositionTracking"("symbol", "updatedAt");
