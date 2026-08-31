-- Add run binding for cross-run isolation.
ALTER TABLE "ShadowCandidateOutcome"
ADD COLUMN IF NOT EXISTS "runId" TEXT;

CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_runId_detectedAt_idx"
ON "ShadowCandidateOutcome"("runId", "detectedAt");

-- Canonical persisted ground-truth movers.
CREATE TABLE IF NOT EXISTS "ShadowMoverEvent" (
  "id" TEXT NOT NULL,
  "moverId" TEXT NOT NULL,
  "runId" TEXT,
  "symbol" TEXT NOT NULL,
  "venue" TEXT NOT NULL,
  "threshold" INTEGER NOT NULL,
  "horizonMin" INTEGER NOT NULL,
  "moveStartAt" TIMESTAMP(3) NOT NULL,
  "moveStartPrice" DOUBLE PRECISION NOT NULL,
  "thresholdReachedAt" TIMESTAMP(3) NOT NULL,
  "thresholdPrice" DOUBLE PRECISION NOT NULL,
  "peakAt" TIMESTAMP(3) NOT NULL,
  "peakPrice" DOUBLE PRECISION NOT NULL,
  "peakMovePercent" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "systemDetected" BOOLEAN NOT NULL DEFAULT false,
  "candidateId" TEXT,
  "firstDetectedAt" TIMESTAMP(3),
  "firstDetectedPrice" DOUBLE PRECISION,
  "lane" TEXT,
  "hot" BOOLEAN NOT NULL DEFAULT false,
  "microAnalyzed" BOOLEAN NOT NULL DEFAULT false,
  "microConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "finalRanked" BOOLEAN NOT NULL DEFAULT false,
  "executionReady" BOOLEAN NOT NULL DEFAULT false,
  "riskAllowed" BOOLEAN NOT NULL DEFAULT false,
  "paperOpened" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShadowMoverEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShadowMoverEvent_moverId_key" ON "ShadowMoverEvent"("moverId");
CREATE UNIQUE INDEX IF NOT EXISTS "ShadowMoverEvent_dedupeKey_key" ON "ShadowMoverEvent"("dedupeKey");
CREATE INDEX IF NOT EXISTS "ShadowMoverEvent_runId_threshold_idx" ON "ShadowMoverEvent"("runId", "threshold");
CREATE INDEX IF NOT EXISTS "ShadowMoverEvent_symbol_thresholdReachedAt_idx" ON "ShadowMoverEvent"("symbol", "thresholdReachedAt");
CREATE INDEX IF NOT EXISTS "ShadowMoverEvent_candidateId_idx" ON "ShadowMoverEvent"("candidateId");
