-- Phase 5 shadow outcome tracking (analytics only, never places orders).
CREATE TABLE IF NOT EXISTS "ShadowCandidateOutcome" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "detectedAt" TIMESTAMP(3) NOT NULL,
  "firstDetectionPrice" DOUBLE PRECISION NOT NULL,
  "lane" TEXT NOT NULL,
  "finalScore" DOUBLE PRECISION NOT NULL,
  "moveKey" TEXT NOT NULL,
  "latestStage" TEXT,
  "latestScore" DOUBLE PRECISION,
  "latestRank" INTEGER,
  "snapshot" JSONB NOT NULL,
  "journey" JSONB NOT NULL,
  "outcomes" JSONB NOT NULL,
  "reachTimes" JSONB NOT NULL,
  "invalidReason" TEXT,
  "source" TEXT NOT NULL DEFAULT 'live',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShadowCandidateOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShadowCandidateOutcome_candidateId_key" ON "ShadowCandidateOutcome"("candidateId");
CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_symbol_detectedAt_idx" ON "ShadowCandidateOutcome"("symbol", "detectedAt");
CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_lane_detectedAt_idx" ON "ShadowCandidateOutcome"("lane", "detectedAt");
CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_finalScore_idx" ON "ShadowCandidateOutcome"("finalScore");
CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_detectedAt_idx" ON "ShadowCandidateOutcome"("detectedAt");
CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_moveKey_idx" ON "ShadowCandidateOutcome"("moveKey");
CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_source_detectedAt_idx" ON "ShadowCandidateOutcome"("source", "detectedAt");
