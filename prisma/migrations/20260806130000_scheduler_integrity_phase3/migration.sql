-- Scheduler Integrity Sprint Phase 3
-- Database integrity: version columns, idempotency keys, active round constraint

ALTER TABLE "AutoRoundJob"
ADD COLUMN IF NOT EXISTS "persistVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "activeRunId" TEXT;

CREATE INDEX IF NOT EXISTS "AutoRoundJob_activeRunId_idx" ON "AutoRoundJob"("activeRunId");

ALTER TABLE "AutoRoundRun"
ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
ADD COLUMN IF NOT EXISTS "persistVersion" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "AutoRoundRun_idempotencyKey_key" ON "AutoRoundRun"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "AutoRoundRun_jobId_roundNo_endedAt_idx" ON "AutoRoundRun"("jobId", "roundNo", "endedAt");

-- At most one open run per (jobId, roundNo)
CREATE UNIQUE INDEX IF NOT EXISTS "AutoRoundRun_jobId_roundNo_active_key"
ON "AutoRoundRun" ("jobId", "roundNo")
WHERE "endedAt" IS NULL;
