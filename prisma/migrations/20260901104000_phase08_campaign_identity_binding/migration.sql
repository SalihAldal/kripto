ALTER TABLE "AutoRoundJob"
ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

ALTER TABLE "AutoRoundRun"
ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

ALTER TABLE "PaperTrade"
ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

ALTER TABLE "PaperExecution"
ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

ALTER TABLE "TradeLifecycleEvent"
ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

ALTER TABLE "ShadowCandidateOutcome"
ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

ALTER TABLE "ShadowMoverEvent"
ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

CREATE INDEX IF NOT EXISTS "AutoRoundJob_campaignId_createdAt_idx"
ON "AutoRoundJob"("campaignId", "createdAt");

CREATE INDEX IF NOT EXISTS "AutoRoundRun_campaignId_startedAt_idx"
ON "AutoRoundRun"("campaignId", "startedAt");

CREATE INDEX IF NOT EXISTS "PaperTrade_campaignId_openedAt_idx"
ON "PaperTrade"("campaignId", "openedAt");

CREATE INDEX IF NOT EXISTS "PaperExecution_campaignId_executedAt_idx"
ON "PaperExecution"("campaignId", "executedAt");

CREATE INDEX IF NOT EXISTS "TradeLifecycleEvent_campaignId_createdAt_idx"
ON "TradeLifecycleEvent"("campaignId", "createdAt");

CREATE INDEX IF NOT EXISTS "ShadowCandidateOutcome_campaignId_detectedAt_idx"
ON "ShadowCandidateOutcome"("campaignId", "detectedAt");

CREATE INDEX IF NOT EXISTS "ShadowMoverEvent_campaignId_threshold_idx"
ON "ShadowMoverEvent"("campaignId", "threshold");
