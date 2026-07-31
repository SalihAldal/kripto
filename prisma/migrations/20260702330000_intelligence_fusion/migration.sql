-- CreateEnum
CREATE TYPE "IntelligenceFusionJobType" AS ENUM ('FUSION_PIPELINE', 'CONFLICT_RESOLVE', 'SOURCE_RELIABILITY', 'NARRATIVE_BUILD', 'EVIDENCE_COLLECT', 'FUSION_REPLAY', 'QUALITY_SCORE', 'KNOWLEDGE_INTEGRATE', 'VALIDATE_PUBLISH');

-- CreateEnum
CREATE TYPE "IntelligenceSourceType" AS ENUM ('MARKET_SNAPSHOT', 'SCANNER', 'NEWS', 'WHALE', 'ONCHAIN', 'PORTFOLIO', 'LEARNING', 'RESEARCH', 'RISK', 'META_AI', 'GOVERNANCE');

-- CreateEnum
CREATE TYPE "FusionAssetClass" AS ENUM ('CRYPTO', 'STOCKS', 'FOREX', 'COMMODITIES', 'ETFS', 'OPTIONS');

-- CreateEnum
CREATE TYPE "ConflictSeverity" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FusionValidationStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'PUBLISHED');

CREATE TABLE "IntelligenceFusion" (
    "id" TEXT NOT NULL, "fusionKey" TEXT NOT NULL, "assetClass" "FusionAssetClass" NOT NULL DEFAULT 'CRYPTO',
    "symbol" TEXT, "status" TEXT NOT NULL DEFAULT 'RUNNING', "sourceCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "metadata" JSONB,
    CONSTRAINT "IntelligenceFusion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketIntelligence" (
    "id" TEXT NOT NULL, "intelligenceKey" TEXT NOT NULL, "fusionId" TEXT NOT NULL,
    "assetClass" "FusionAssetClass" NOT NULL DEFAULT 'CRYPTO', "symbol" TEXT,
    "marketScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "trendScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "momentumScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "volumeScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "liquidityScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "orderBookScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "newsScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "whaleScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "onChainScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "portfolioScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "riskScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "learningScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "researchScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "macroScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "regimeScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "volatilityScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "validationStatus" "FusionValidationStatus" NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3), "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketIntelligence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FusedMarketContext" (
    "id" TEXT NOT NULL, "contextKey" TEXT NOT NULL, "fusionId" TEXT NOT NULL,
    "assetClass" "FusionAssetClass" NOT NULL DEFAULT 'CRYPTO', "symbol" TEXT,
    "marketSnapshot" JSONB, "scannerData" JSONB, "newsData" JSONB, "whaleData" JSONB,
    "onChainData" JSONB, "portfolioData" JSONB, "learningData" JSONB, "researchData" JSONB,
    "riskData" JSONB, "metaAiData" JSONB, "governanceData" JSONB, "knowledgeGraph" JSONB,
    "metadata" JSONB, "fusedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FusedMarketContext_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceConfidence" (
    "id" TEXT NOT NULL, "sourceType" "IntelligenceSourceType" NOT NULL,
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "historicalAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "sampleCount" INTEGER NOT NULL DEFAULT 0, "lastCorrectAt" TIMESTAMP(3), "lastIncorrectAt" TIMESTAMP(3),
    "metadata" JSONB, "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourceConfidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConflictMatrix" (
    "id" TEXT NOT NULL, "fusionId" TEXT NOT NULL, "matrix" JSONB NOT NULL,
    "conflictCount" INTEGER NOT NULL DEFAULT 0, "severity" "ConflictSeverity" NOT NULL DEFAULT 'NONE',
    "recommendedInterpretation" TEXT NOT NULL, "metadata" JSONB,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConflictMatrix_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FusionTimeline" (
    "id" TEXT NOT NULL, "timelineKey" TEXT NOT NULL, "intelligenceId" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "scores" JSONB NOT NULL,
    "contextHash" TEXT, "replayable" BOOLEAN NOT NULL DEFAULT true, "metadata" JSONB,
    CONSTRAINT "FusionTimeline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FusionQuality" (
    "id" TEXT NOT NULL, "fusionId" TEXT NOT NULL,
    "completeness" DOUBLE PRECISION NOT NULL DEFAULT 50, "freshness" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "consistency" DOUBLE PRECISION NOT NULL DEFAULT 50, "conflictLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50, "coverage" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "qualityScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "metadata" JSONB,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FusionQuality_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NarrativeContext" (
    "id" TEXT NOT NULL, "narrativeKey" TEXT NOT NULL, "fusionId" TEXT NOT NULL,
    "title" TEXT NOT NULL, "story" TEXT NOT NULL, "segments" JSONB,
    "heatScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "active" BOOLEAN NOT NULL DEFAULT true, "metadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NarrativeContext_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvidenceStore" (
    "id" TEXT NOT NULL, "evidenceKey" TEXT NOT NULL, "fusionId" TEXT NOT NULL,
    "scoreName" TEXT NOT NULL, "source" "IntelligenceSourceType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL, "supportingEvidence" JSONB NOT NULL,
    "evidenceTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "freshness" DOUBLE PRECISION NOT NULL DEFAULT 100, "historicalAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50, "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceStore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntelligenceFusionJobState" (
    "id" TEXT NOT NULL, "jobType" "IntelligenceFusionJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'IDLE', "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntelligenceFusionJobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IntelligenceFusion_fusionKey_key" ON "IntelligenceFusion"("fusionKey");
CREATE INDEX "IntelligenceFusion_status_startedAt_idx" ON "IntelligenceFusion"("status", "startedAt");
CREATE INDEX "IntelligenceFusion_assetClass_startedAt_idx" ON "IntelligenceFusion"("assetClass", "startedAt");

CREATE UNIQUE INDEX "MarketIntelligence_intelligenceKey_key" ON "MarketIntelligence"("intelligenceKey");
CREATE UNIQUE INDEX "MarketIntelligence_fusionId_key" ON "MarketIntelligence"("fusionId");
CREATE INDEX "MarketIntelligence_validationStatus_publishedAt_idx" ON "MarketIntelligence"("validationStatus", "publishedAt");
CREATE INDEX "MarketIntelligence_assetClass_publishedAt_idx" ON "MarketIntelligence"("assetClass", "publishedAt");
CREATE INDEX "MarketIntelligence_marketScore_publishedAt_idx" ON "MarketIntelligence"("marketScore", "publishedAt");

CREATE UNIQUE INDEX "FusedMarketContext_contextKey_key" ON "FusedMarketContext"("contextKey");
CREATE UNIQUE INDEX "FusedMarketContext_fusionId_key" ON "FusedMarketContext"("fusionId");
CREATE INDEX "FusedMarketContext_fusedAt_idx" ON "FusedMarketContext"("fusedAt");

CREATE UNIQUE INDEX "SourceConfidence_sourceType_key" ON "SourceConfidence"("sourceType");
CREATE INDEX "SourceConfidence_trustScore_idx" ON "SourceConfidence"("trustScore");

CREATE UNIQUE INDEX "ConflictMatrix_fusionId_key" ON "ConflictMatrix"("fusionId");
CREATE INDEX "ConflictMatrix_severity_resolvedAt_idx" ON "ConflictMatrix"("severity", "resolvedAt");

CREATE UNIQUE INDEX "FusionTimeline_timelineKey_key" ON "FusionTimeline"("timelineKey");
CREATE INDEX "FusionTimeline_intelligenceId_snapshotAt_idx" ON "FusionTimeline"("intelligenceId", "snapshotAt");
CREATE INDEX "FusionTimeline_snapshotAt_idx" ON "FusionTimeline"("snapshotAt");

CREATE UNIQUE INDEX "FusionQuality_fusionId_key" ON "FusionQuality"("fusionId");
CREATE INDEX "FusionQuality_qualityScore_scoredAt_idx" ON "FusionQuality"("qualityScore", "scoredAt");

CREATE UNIQUE INDEX "NarrativeContext_narrativeKey_key" ON "NarrativeContext"("narrativeKey");
CREATE INDEX "NarrativeContext_active_heatScore_idx" ON "NarrativeContext"("active", "heatScore");
CREATE INDEX "NarrativeContext_fusionId_idx" ON "NarrativeContext"("fusionId");

CREATE UNIQUE INDEX "EvidenceStore_evidenceKey_key" ON "EvidenceStore"("evidenceKey");
CREATE INDEX "EvidenceStore_fusionId_scoreName_idx" ON "EvidenceStore"("fusionId", "scoreName");
CREATE INDEX "EvidenceStore_source_scoreName_idx" ON "EvidenceStore"("source", "scoreName");

CREATE UNIQUE INDEX "IntelligenceFusionJobState_jobType_key" ON "IntelligenceFusionJobState"("jobType");

ALTER TABLE "MarketIntelligence" ADD CONSTRAINT "MarketIntelligence_fusionId_fkey" FOREIGN KEY ("fusionId") REFERENCES "IntelligenceFusion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FusedMarketContext" ADD CONSTRAINT "FusedMarketContext_fusionId_fkey" FOREIGN KEY ("fusionId") REFERENCES "IntelligenceFusion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConflictMatrix" ADD CONSTRAINT "ConflictMatrix_fusionId_fkey" FOREIGN KEY ("fusionId") REFERENCES "IntelligenceFusion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FusionTimeline" ADD CONSTRAINT "FusionTimeline_intelligenceId_fkey" FOREIGN KEY ("intelligenceId") REFERENCES "MarketIntelligence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FusionQuality" ADD CONSTRAINT "FusionQuality_fusionId_fkey" FOREIGN KEY ("fusionId") REFERENCES "IntelligenceFusion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NarrativeContext" ADD CONSTRAINT "NarrativeContext_fusionId_fkey" FOREIGN KEY ("fusionId") REFERENCES "IntelligenceFusion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceStore" ADD CONSTRAINT "EvidenceStore_fusionId_fkey" FOREIGN KEY ("fusionId") REFERENCES "IntelligenceFusion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
