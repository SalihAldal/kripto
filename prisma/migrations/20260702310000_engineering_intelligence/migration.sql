-- CreateEnum
CREATE TYPE "EngineeringIntelligenceJobType" AS ENUM ('DAILY_AUDIT', 'WEEKLY_AUDIT', 'ARCHITECTURE_SCAN', 'CODE_QUALITY_SCAN', 'PERFORMANCE_SCAN', 'SECURITY_SCAN', 'DATABASE_SCAN', 'QUEUE_SCAN', 'API_SCAN', 'INFRASTRUCTURE_SCAN', 'DEPENDENCY_SCAN', 'DOCUMENTATION_SCAN', 'TEST_SCAN', 'OBSERVABILITY_SCAN', 'BUSINESS_RULE_SCAN', 'AI_USAGE_SCAN', 'TRADING_PLATFORM_SCAN', 'HEALTH_SCORE', 'REFACTORING_ADVISE');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('ARCHITECTURE', 'CODE_QUALITY', 'PERFORMANCE', 'SECURITY', 'DATABASE', 'QUEUE', 'API', 'AI', 'TRADING_PLATFORM', 'INFRASTRUCTURE', 'DEPENDENCY', 'DOCUMENTATION', 'TEST', 'OBSERVABILITY', 'BUSINESS_RULE');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('PASSED', 'WARNING', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "EngineeringAudit" (
    "id" TEXT NOT NULL,
    "auditKey" TEXT NOT NULL,
    "auditType" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "summary" TEXT NOT NULL,
    "findingsCount" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "evidence" JSONB,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineeringAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchitectureAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "modulePath" TEXT,
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArchitectureAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "target" TEXT,
    "metric" TEXT,
    "value" DOUBLE PRECISION,
    "threshold" DOUBLE PRECISION,
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PerformanceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "checkName" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "filePath" TEXT,
    "finding" TEXT NOT NULL,
    "cveId" TEXT,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DependencyAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "currentVersion" TEXT,
    "latestVersion" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "finding" TEXT NOT NULL,
    "license" TEXT,
    "cveIds" TEXT[],
    "isUnused" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DependencyAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeQualityAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "smellType" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "filePath" TEXT,
    "lineNumber" INTEGER,
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CodeQualityAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "pendingJobs" INTEGER NOT NULL DEFAULT 0,
    "failedJobs" INTEGER NOT NULL DEFAULT 0,
    "avgProcessMs" DOUBLE PRECISION,
    "workerHealth" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QueueAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "routePath" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "responseTimeMs" DOUBLE PRECISION,
    "hasAuth" BOOLEAN NOT NULL DEFAULT false,
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfrastructureAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InfrastructureAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "modulePath" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "coveragePct" DOUBLE PRECISION,
    "testCount" INTEGER NOT NULL DEFAULT 0,
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TestAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentationAudit" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docPath" TEXT,
    "status" "AuditStatus" NOT NULL DEFAULT 'PASSED',
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "finding" TEXT NOT NULL,
    "evidence" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringRecommendation" (
    "id" TEXT NOT NULL,
    "auditId" TEXT,
    "category" "AuditCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB,
    "expectedImpact" TEXT,
    "effortEstimate" TEXT,
    "riskLevel" "AuditSeverity" NOT NULL DEFAULT 'MEDIUM',
    "priority" "AuditSeverity" NOT NULL DEFAULT 'MEDIUM',
    "affectedModules" TEXT[],
    "status" "RecommendationStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EngineeringRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TechnicalDebt" (
    "id" TEXT NOT NULL,
    "debtKey" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'MEDIUM',
    "modulePath" TEXT,
    "estimatedHours" DOUBLE PRECISION,
    "interestScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "evidence" JSONB,
    "metadata" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "TechnicalDebt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringHealth" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "architectureScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "codeQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "securityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "performanceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scalabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maintainabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reliabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "testScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "observabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "documentationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "technicalDebtScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "criticalIssues" INTEGER NOT NULL DEFAULT 0,
    "highIssues" INTEGER NOT NULL DEFAULT 0,
    "mediumIssues" INTEGER NOT NULL DEFAULT 0,
    "lowIssues" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineeringHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineeringIntelligenceJobState" (
    "id" TEXT NOT NULL,
    "jobType" "EngineeringIntelligenceJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineeringIntelligenceJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EngineeringAudit_auditKey_key" ON "EngineeringAudit"("auditKey");
CREATE INDEX "EngineeringAudit_category_startedAt_idx" ON "EngineeringAudit"("category", "startedAt");
CREATE INDEX "EngineeringAudit_severity_startedAt_idx" ON "EngineeringAudit"("severity", "startedAt");
CREATE INDEX "EngineeringAudit_auditType_startedAt_idx" ON "EngineeringAudit"("auditType", "startedAt");
CREATE INDEX "ArchitectureAudit_auditId_severity_idx" ON "ArchitectureAudit"("auditId", "severity");
CREATE INDEX "ArchitectureAudit_checkName_recordedAt_idx" ON "ArchitectureAudit"("checkName", "recordedAt");
CREATE INDEX "PerformanceAudit_auditId_severity_idx" ON "PerformanceAudit"("auditId", "severity");
CREATE INDEX "PerformanceAudit_checkName_recordedAt_idx" ON "PerformanceAudit"("checkName", "recordedAt");
CREATE INDEX "SecurityAudit_auditId_severity_idx" ON "SecurityAudit"("auditId", "severity");
CREATE INDEX "SecurityAudit_checkName_recordedAt_idx" ON "SecurityAudit"("checkName", "recordedAt");
CREATE INDEX "DependencyAudit_auditId_severity_idx" ON "DependencyAudit"("auditId", "severity");
CREATE INDEX "DependencyAudit_packageName_recordedAt_idx" ON "DependencyAudit"("packageName", "recordedAt");
CREATE INDEX "CodeQualityAudit_auditId_severity_idx" ON "CodeQualityAudit"("auditId", "severity");
CREATE INDEX "CodeQualityAudit_smellType_recordedAt_idx" ON "CodeQualityAudit"("smellType", "recordedAt");
CREATE INDEX "QueueAudit_auditId_severity_idx" ON "QueueAudit"("auditId", "severity");
CREATE INDEX "QueueAudit_queueName_recordedAt_idx" ON "QueueAudit"("queueName", "recordedAt");
CREATE INDEX "ApiAudit_auditId_severity_idx" ON "ApiAudit"("auditId", "severity");
CREATE INDEX "ApiAudit_routePath_recordedAt_idx" ON "ApiAudit"("routePath", "recordedAt");
CREATE INDEX "InfrastructureAudit_auditId_severity_idx" ON "InfrastructureAudit"("auditId", "severity");
CREATE INDEX "InfrastructureAudit_component_recordedAt_idx" ON "InfrastructureAudit"("component", "recordedAt");
CREATE INDEX "TestAudit_auditId_severity_idx" ON "TestAudit"("auditId", "severity");
CREATE INDEX "TestAudit_modulePath_recordedAt_idx" ON "TestAudit"("modulePath", "recordedAt");
CREATE INDEX "DocumentationAudit_auditId_severity_idx" ON "DocumentationAudit"("auditId", "severity");
CREATE INDEX "DocumentationAudit_docType_recordedAt_idx" ON "DocumentationAudit"("docType", "recordedAt");
CREATE INDEX "EngineeringRecommendation_category_status_idx" ON "EngineeringRecommendation"("category", "status");
CREATE INDEX "EngineeringRecommendation_priority_status_idx" ON "EngineeringRecommendation"("priority", "status");
CREATE INDEX "EngineeringRecommendation_createdAt_idx" ON "EngineeringRecommendation"("createdAt");
CREATE UNIQUE INDEX "TechnicalDebt_debtKey_key" ON "TechnicalDebt"("debtKey");
CREATE INDEX "TechnicalDebt_category_isResolved_idx" ON "TechnicalDebt"("category", "isResolved");
CREATE INDEX "TechnicalDebt_severity_isResolved_idx" ON "TechnicalDebt"("severity", "isResolved");
CREATE INDEX "TechnicalDebt_interestScore_detectedAt_idx" ON "TechnicalDebt"("interestScore", "detectedAt");
CREATE UNIQUE INDEX "EngineeringHealth_reportKey_key" ON "EngineeringHealth"("reportKey");
CREATE INDEX "EngineeringHealth_reportType_scoredAt_idx" ON "EngineeringHealth"("reportType", "scoredAt");
CREATE INDEX "EngineeringHealth_overallScore_scoredAt_idx" ON "EngineeringHealth"("overallScore", "scoredAt");
CREATE UNIQUE INDEX "EngineeringIntelligenceJobState_jobType_key" ON "EngineeringIntelligenceJobState"("jobType");

-- AddForeignKey
ALTER TABLE "ArchitectureAudit" ADD CONSTRAINT "ArchitectureAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PerformanceAudit" ADD CONSTRAINT "PerformanceAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityAudit" ADD CONSTRAINT "SecurityAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DependencyAudit" ADD CONSTRAINT "DependencyAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodeQualityAudit" ADD CONSTRAINT "CodeQualityAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QueueAudit" ADD CONSTRAINT "QueueAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiAudit" ADD CONSTRAINT "ApiAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InfrastructureAudit" ADD CONSTRAINT "InfrastructureAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestAudit" ADD CONSTRAINT "TestAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentationAudit" ADD CONSTRAINT "DocumentationAudit_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EngineeringRecommendation" ADD CONSTRAINT "EngineeringRecommendation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "EngineeringAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
