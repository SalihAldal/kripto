-- CreateEnum
CREATE TYPE "MetaIntelligenceJobType" AS ENUM ('CONTEXT_BUILD', 'CONTEXT_FUSION', 'CONFLICT_RESOLVE', 'CONFIDENCE_CALIBRATE', 'EXECUTIVE_REASON', 'NARRATIVE_BUILD', 'PRIORITY_RANK', 'COMMITTEE_MEET', 'EXECUTIVE_REPORT', 'EXECUTIVE_LEARN', 'KNOWLEDGE_BUILD', 'FUTURE_PLAN', 'KPI_TRACK', 'STRATEGIC_OBJECTIVES');

-- CreateEnum
CREATE TYPE "MarketRegime" AS ENUM ('BULL_EXPANSION', 'BEAR_CONTRACTION', 'RISK_ON', 'RISK_OFF', 'LIQUIDITY_ROTATION', 'MACRO_PANIC', 'SIDEWAYS', 'HIGH_VOLATILITY', 'LOW_VOLATILITY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExecutiveNarrativeType" AS ENUM ('BULL_EXPANSION', 'LIQUIDITY_ROTATION', 'RISK_OFF', 'RISK_ON', 'AI_NARRATIVE', 'MEME_SEASON', 'LAYER1_ROTATION', 'STABLECOIN_EXPANSION', 'MACRO_PANIC', 'WHALE_ACCUMULATION', 'INSTITUTIONAL_ENTRY', 'DEFI_REVIVAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CommitteeRole" AS ENUM ('RISK_OFFICER', 'PORTFOLIO_MANAGER', 'RESEARCH_DIRECTOR', 'MARKET_STRATEGIST', 'MACRO_ANALYST', 'EXECUTION_DIRECTOR', 'NEWS_DIRECTOR', 'WHALE_DIRECTOR', 'ONCHAIN_DIRECTOR', 'META_AI');

-- CreateEnum
CREATE TYPE "ExecutiveReportType" AS ENUM ('MORNING_BRIEFING', 'MIDDAY_BRIEFING', 'EVENING_BRIEFING', 'DAILY_EXECUTIVE', 'WEEKLY_CIO', 'MONTHLY_IC');

-- CreateEnum
CREATE TYPE "StrategicObjectiveType" AS ENUM ('CAPITAL_PRESERVATION', 'GROWTH', 'RISK_CONTROL', 'PORTFOLIO_STABILITY', 'LEARNING_SPEED', 'EXECUTION_RELIABILITY');

-- CreateEnum
CREATE TYPE "ExecutivePriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateTable MetaContext, ExecutiveDecision, ExecutiveSummary, MarketNarrative, ExecutiveRecommendation, CommitteeMeeting, StrategicObjective, ExecutiveMemory, MetaKnowledge, ExecutiveReport, ExecutiveKpi, MetaIntelligenceJobState
-- (Full SQL follows schema - abbreviated indexes and FKs)

CREATE TABLE "MetaContext" (
    "id" TEXT NOT NULL, "contextKey" TEXT NOT NULL, "marketRegime" "MarketRegime" NOT NULL DEFAULT 'UNKNOWN',
    "scannerSnapshot" JSONB, "newsSnapshot" JSONB, "whaleSnapshot" JSONB, "onChainSnapshot" JSONB,
    "portfolioSnapshot" JSONB, "riskSnapshot" JSONB, "learningSnapshot" JSONB, "researchSnapshot" JSONB,
    "governanceSnapshot" JSONB, "engineeringSnapshot" JSONB, "fusedGraph" JSONB,
    "overallConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50, "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB, "builtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaContext_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutiveDecision" (
    "id" TEXT NOT NULL, "contextId" TEXT, "decisionKey" TEXT NOT NULL, "recommendation" TEXT NOT NULL,
    "conflictSummary" TEXT, "resolution" TEXT NOT NULL, "overallConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50, "marketConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "executionConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50, "portfolioConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "modelConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50, "supportingEvidence" JSONB, "historicalSimilarity" DOUBLE PRECISION,
    "expectedBenefit" TEXT, "expectedRisk" TEXT, "implementationCost" TEXT, "priority" "ExecutivePriority" NOT NULL DEFAULT 'MEDIUM',
    "metadata" JSONB, "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutiveDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutiveSummary" (
    "id" TEXT NOT NULL, "contextId" TEXT, "summaryType" TEXT NOT NULL, "title" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL, "reasoning" TEXT NOT NULL, "whyNotWhat" TEXT, "keyInsights" TEXT[],
    "metadata" JSONB, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutiveSummary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketNarrative" (
    "id" TEXT NOT NULL, "narrativeKey" TEXT NOT NULL, "narrativeType" "ExecutiveNarrativeType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL, "story" TEXT NOT NULL, "marketRegime" "MarketRegime" NOT NULL DEFAULT 'UNKNOWN',
    "heatScore" DOUBLE PRECISION NOT NULL DEFAULT 50, "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "supportingSignals" JSONB, "metadata" JSONB, "active" BOOLEAN NOT NULL DEFAULT true,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketNarrative_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutiveRecommendation" (
    "id" TEXT NOT NULL, "category" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
    "supportingEvidence" JSONB, "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50, "historicalSimilarity" DOUBLE PRECISION,
    "expectedBenefit" TEXT, "expectedRisk" TEXT, "implementationCost" TEXT, "priority" "ExecutivePriority" NOT NULL DEFAULT 'MEDIUM',
    "affectedModules" TEXT[], "status" TEXT NOT NULL DEFAULT 'OPEN', "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExecutiveRecommendation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommitteeMeeting" (
    "id" TEXT NOT NULL, "meetingKey" TEXT NOT NULL, "topic" TEXT NOT NULL, "opinions" JSONB NOT NULL,
    "consensus" TEXT, "dissent" JSONB, "metaSummary" TEXT NOT NULL, "overallConfidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB, "heldAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommitteeMeeting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StrategicObjective" (
    "id" TEXT NOT NULL, "objectiveType" "StrategicObjectiveType" NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
    "targetScore" DOUBLE PRECISION NOT NULL DEFAULT 80, "currentScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "progressPct" DOUBLE PRECISION NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB, "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategicObjective_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutiveMemory" (
    "id" TEXT NOT NULL, "memoryKey" TEXT NOT NULL, "memoryType" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL,
    "impact" TEXT, "lessonLearned" TEXT, "marketRegime" "MarketRegime", "tags" TEXT[], "confidence" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutiveMemory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetaKnowledge" (
    "id" TEXT NOT NULL, "nodeKey" TEXT NOT NULL, "nodeType" TEXT NOT NULL, "label" TEXT NOT NULL,
    "relations" JSONB, "weight" DOUBLE PRECISION NOT NULL DEFAULT 1, "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaKnowledge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutiveReport" (
    "id" TEXT NOT NULL, "reportKey" TEXT NOT NULL, "reportType" "ExecutiveReportType" NOT NULL,
    "title" TEXT NOT NULL, "content" TEXT NOT NULL, "highlights" TEXT[], "risks" TEXT[], "opportunities" TEXT[],
    "kpis" JSONB, "metadata" JSONB, "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutiveReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExecutiveKpi" (
    "id" TEXT NOT NULL, "snapshotKey" TEXT NOT NULL, "platformHealth" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "tradingHealth" DOUBLE PRECISION NOT NULL DEFAULT 50, "learningVelocity" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "researchVelocity" DOUBLE PRECISION NOT NULL DEFAULT 50, "systemStability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "decisionAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 50, "engineeringHealth" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "riskExposure" DOUBLE PRECISION NOT NULL DEFAULT 50, "portfolioHealth" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "marketIntelligenceQuality" DOUBLE PRECISION NOT NULL DEFAULT 50, "overallExecutiveScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "metadata" JSONB, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExecutiveKpi_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MetaIntelligenceJobState" (
    "id" TEXT NOT NULL, "jobType" "MetaIntelligenceJobType" NOT NULL, "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE', "metadata" JSONB, "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetaIntelligenceJobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaContext_contextKey_key" ON "MetaContext"("contextKey");
CREATE INDEX "MetaContext_marketRegime_builtAt_idx" ON "MetaContext"("marketRegime", "builtAt");
CREATE UNIQUE INDEX "ExecutiveDecision_decisionKey_key" ON "ExecutiveDecision"("decisionKey");
CREATE INDEX "ExecutiveDecision_priority_decidedAt_idx" ON "ExecutiveDecision"("priority", "decidedAt");
CREATE UNIQUE INDEX "MarketNarrative_narrativeKey_key" ON "MarketNarrative"("narrativeKey");
CREATE INDEX "MarketNarrative_narrativeType_heatScore_idx" ON "MarketNarrative"("narrativeType", "heatScore");
CREATE INDEX "ExecutiveRecommendation_category_status_idx" ON "ExecutiveRecommendation"("category", "status");
CREATE UNIQUE INDEX "CommitteeMeeting_meetingKey_key" ON "CommitteeMeeting"("meetingKey");
CREATE UNIQUE INDEX "ExecutiveMemory_memoryKey_key" ON "ExecutiveMemory"("memoryKey");
CREATE UNIQUE INDEX "MetaKnowledge_nodeKey_key" ON "MetaKnowledge"("nodeKey");
CREATE UNIQUE INDEX "ExecutiveReport_reportKey_key" ON "ExecutiveReport"("reportKey");
CREATE UNIQUE INDEX "ExecutiveKpi_snapshotKey_key" ON "ExecutiveKpi"("snapshotKey");
CREATE UNIQUE INDEX "MetaIntelligenceJobState_jobType_key" ON "MetaIntelligenceJobState"("jobType");

ALTER TABLE "ExecutiveDecision" ADD CONSTRAINT "ExecutiveDecision_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "MetaContext"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExecutiveSummary" ADD CONSTRAINT "ExecutiveSummary_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "MetaContext"("id") ON DELETE SET NULL ON UPDATE CASCADE;
