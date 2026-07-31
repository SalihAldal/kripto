-- Hot Path Foundation F1 20260702410000
CREATE TYPE "HotPathAuditStatus" AS ENUM ('PASS', 'WARN', 'FAIL');

CREATE TABLE "HotPathAuditSnapshot" (
  "id" TEXT NOT NULL,
  "auditKey" TEXT NOT NULL,
  "overallStatus" "HotPathAuditStatus" NOT NULL DEFAULT 'WARN',
  "hotPathStages" JSONB NOT NULL,
  "workerPolicy" JSONB NOT NULL,
  "integrationGaps" JSONB,
  "workerCount" INTEGER NOT NULL DEFAULT 0,
  "frozenWorkerCount" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HotPathAuditSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HotPathAuditSnapshot_auditKey_key" ON "HotPathAuditSnapshot"("auditKey");
CREATE INDEX "HotPathAuditSnapshot_overallStatus_generatedAt_idx" ON "HotPathAuditSnapshot"("overallStatus", "generatedAt");
CREATE INDEX "HotPathAuditSnapshot_generatedAt_idx" ON "HotPathAuditSnapshot"("generatedAt");
