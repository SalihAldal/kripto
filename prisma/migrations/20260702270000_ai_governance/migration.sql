-- CreateEnum
CREATE TYPE "AiGovernanceJobType" AS ENUM ('DEPLOYMENT_PROCESS', 'ROLLBACK_CHECK', 'APPROVAL_PROCESS', 'HEALTH_MONITOR', 'GOVERNANCE_MONITOR', 'AUDIT_SYNC', 'CANARY_EVALUATE', 'SHADOW_EVALUATE', 'FEATURE_FLAG_SYNC', 'CONFIG_VALIDATE', 'PROMOTION_EVALUATE');

-- CreateEnum
CREATE TYPE "ModelRegistryType" AS ENUM ('AI_MODEL', 'SCANNER', 'STRATEGY', 'PROMPT', 'THRESHOLD', 'RISK_PROFILE', 'PORTFOLIO_PROFILE', 'EXECUTION_PROFILE', 'LEARNING_CONFIG');

-- CreateEnum
CREATE TYPE "VersionStage" AS ENUM ('PATCH', 'MINOR', 'MAJOR', 'EXPERIMENTAL', 'CANDIDATE', 'PRODUCTION', 'DEPRECATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DeploymentStage" AS ENUM ('DEVELOPMENT', 'TESTING', 'PAPER', 'SHADOW', 'CANARY', 'STAGING', 'PRODUCTION', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('RESEARCH', 'REPLAY', 'RISK', 'PERFORMANCE', 'GOVERNANCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "RollbackReason" AS ENUM ('PROFIT_FACTOR_DROP', 'WIN_RATE_DROP', 'DRAWDOWN_EXCEEDED', 'RISK_INCREASE', 'CONFIDENCE_COLLAPSE', 'EXECUTION_ERRORS', 'MANUAL', 'HEALTH_CHECK');

-- CreateEnum
CREATE TYPE "FeatureFlagStatus" AS ENUM ('ENABLED', 'DISABLED', 'PARTIAL', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "ConfigDomain" AS ENUM ('THRESHOLDS', 'WEIGHTS', 'SCANNER', 'RISK', 'EXECUTION', 'PORTFOLIO', 'LEARNING', 'GENERAL');

-- CreateEnum
CREATE TYPE "GovernanceAuditAction" AS ENUM ('REGISTER', 'VERSION_CREATE', 'DEPLOY_START', 'DEPLOY_COMPLETE', 'DEPLOY_FAIL', 'ROLLBACK', 'APPROVAL_GRANT', 'APPROVAL_REJECT', 'FEATURE_ENABLE', 'FEATURE_DISABLE', 'CONFIG_UPDATE', 'EMERGENCY', 'PROMOTION');

-- CreateTable
CREATE TABLE "ModelRegistry" (
    "id" TEXT NOT NULL,
    "registryKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registryType" "ModelRegistryType" NOT NULL,
    "description" TEXT,
    "owner" TEXT,
    "tenantId" TEXT,
    "exchange" TEXT,
    "accountId" TEXT,
    "region" TEXT,
    "fundId" TEXT,
    "clientId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL,
    "registryId" TEXT NOT NULL,
    "versionTag" TEXT NOT NULL,
    "stage" "VersionStage" NOT NULL DEFAULT 'EXPERIMENTAL',
    "semverMajor" INTEGER NOT NULL DEFAULT 1,
    "semverMinor" INTEGER NOT NULL DEFAULT 0,
    "semverPatch" INTEGER NOT NULL DEFAULT 0,
    "changelog" TEXT,
    "artifactHash" TEXT,
    "config" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "deploymentKey" TEXT NOT NULL,
    "stage" "DeploymentStage" NOT NULL,
    "status" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
    "canaryPct" DOUBLE PRECISION,
    "environment" TEXT NOT NULL DEFAULT 'development',
    "exchange" TEXT,
    "accountId" TEXT,
    "tenantId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentHistory" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "fromStage" "DeploymentStage",
    "toStage" "DeploymentStage" NOT NULL,
    "fromStatus" "DeploymentStatus",
    "toStatus" "DeploymentStatus" NOT NULL,
    "canaryPct" DOUBLE PRECISION,
    "actor" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeploymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "versionId" TEXT,
    "deploymentId" TEXT,
    "approvalType" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT,
    "assignedTo" TEXT,
    "rationale" TEXT,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalHistory" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL,
    "actor" TEXT,
    "comment" TEXT,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RollbackHistory" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT,
    "versionId" TEXT,
    "reason" "RollbackReason" NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'AUTOMATIC',
    "actor" TEXT,
    "fromVersion" TEXT,
    "toVersion" TEXT,
    "metrics" JSONB,
    "metadata" JSONB,
    "rolledBackAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RollbackHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "FeatureFlagStatus" NOT NULL DEFAULT 'DISABLED',
    "rolloutPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "exchange" TEXT,
    "accountId" TEXT,
    "tenantId" TEXT,
    "abVariant" TEXT,
    "metadata" JSONB,
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigurationVersion" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "domain" "ConfigDomain" NOT NULL,
    "versionTag" TEXT NOT NULL,
    "semverMajor" INTEGER NOT NULL DEFAULT 1,
    "semverMinor" INTEGER NOT NULL DEFAULT 0,
    "semverPatch" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL,
    "checksum" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "tenantId" TEXT,
    "exchange" TEXT,
    "accountId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigurationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceAudit" (
    "id" TEXT NOT NULL,
    "action" "GovernanceAuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "actor" TEXT,
    "tenantId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "checksum" TEXT,
    "immutable" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GovernanceAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionCandidate" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "researchPassed" BOOLEAN NOT NULL DEFAULT false,
    "replayPassed" BOOLEAN NOT NULL DEFAULT false,
    "shadowPassed" BOOLEAN NOT NULL DEFAULT false,
    "canaryPassed" BOOLEAN NOT NULL DEFAULT false,
    "riskPassed" BOOLEAN NOT NULL DEFAULT false,
    "governancePassed" BOOLEAN NOT NULL DEFAULT false,
    "manualApproved" BOOLEAN NOT NULL DEFAULT false,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "blockers" JSONB,
    "scorecard" JSONB,
    "metadata" JSONB,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovernanceHealthSnapshot" (
    "id" TEXT NOT NULL,
    "profitFactor" DOUBLE PRECISION,
    "winRate" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "maxDrawdownPct" DOUBLE PRECISION,
    "executionSuccess" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "portfolioHealth" DOUBLE PRECISION,
    "decisionAccuracy" DOUBLE PRECISION,
    "rejectAccuracy" DOUBLE PRECISION,
    "deploymentId" TEXT,
    "versionId" TEXT,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GovernanceHealthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyControl" (
    "id" TEXT NOT NULL,
    "controlKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "environment" TEXT,
    "exchange" TEXT,
    "accountId" TEXT,
    "tenantId" TEXT,
    "reason" TEXT,
    "actor" TEXT,
    "metadata" JSONB,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmergencyControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiGovernanceJobState" (
    "id" TEXT NOT NULL,
    "jobType" "AiGovernanceJobType" NOT NULL,
    "lastProcessedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiGovernanceJobState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelRegistry_registryKey_key" ON "ModelRegistry"("registryKey");
CREATE INDEX "ModelRegistry_registryType_active_idx" ON "ModelRegistry"("registryType", "active");
CREATE INDEX "ModelRegistry_tenantId_registryType_idx" ON "ModelRegistry"("tenantId", "registryType");
CREATE INDEX "ModelRegistry_exchange_accountId_idx" ON "ModelRegistry"("exchange", "accountId");
CREATE UNIQUE INDEX "ModelVersion_registryId_versionTag_key" ON "ModelVersion"("registryId", "versionTag");
CREATE INDEX "ModelVersion_registryId_stage_idx" ON "ModelVersion"("registryId", "stage");
CREATE INDEX "ModelVersion_stage_createdAt_idx" ON "ModelVersion"("stage", "createdAt");
CREATE UNIQUE INDEX "Deployment_deploymentKey_key" ON "Deployment"("deploymentKey");
CREATE INDEX "Deployment_versionId_stage_idx" ON "Deployment"("versionId", "stage");
CREATE INDEX "Deployment_status_stage_idx" ON "Deployment"("status", "stage");
CREATE INDEX "Deployment_environment_status_idx" ON "Deployment"("environment", "status");
CREATE INDEX "DeploymentHistory_deploymentId_recordedAt_idx" ON "DeploymentHistory"("deploymentId", "recordedAt");
CREATE INDEX "ApprovalRequest_status_approvalType_idx" ON "ApprovalRequest"("status", "approvalType");
CREATE INDEX "ApprovalRequest_versionId_idx" ON "ApprovalRequest"("versionId");
CREATE INDEX "ApprovalRequest_deploymentId_idx" ON "ApprovalRequest"("deploymentId");
CREATE INDEX "ApprovalHistory_approvalRequestId_recordedAt_idx" ON "ApprovalHistory"("approvalRequestId", "recordedAt");
CREATE INDEX "RollbackHistory_deploymentId_rolledBackAt_idx" ON "RollbackHistory"("deploymentId", "rolledBackAt");
CREATE INDEX "RollbackHistory_reason_rolledBackAt_idx" ON "RollbackHistory"("reason", "rolledBackAt");
CREATE UNIQUE INDEX "FeatureFlag_flagKey_environment_exchange_accountId_tenantId_key" ON "FeatureFlag"("flagKey", "environment", "exchange", "accountId", "tenantId");
CREATE INDEX "FeatureFlag_status_environment_idx" ON "FeatureFlag"("status", "environment");
CREATE INDEX "FeatureFlag_flagKey_idx" ON "FeatureFlag"("flagKey");
CREATE UNIQUE INDEX "ConfigurationVersion_configKey_versionTag_environment_key" ON "ConfigurationVersion"("configKey", "versionTag", "environment");
CREATE INDEX "ConfigurationVersion_domain_active_idx" ON "ConfigurationVersion"("domain", "active");
CREATE INDEX "ConfigurationVersion_configKey_environment_idx" ON "ConfigurationVersion"("configKey", "environment");
CREATE INDEX "GovernanceAudit_action_recordedAt_idx" ON "GovernanceAudit"("action", "recordedAt");
CREATE INDEX "GovernanceAudit_entityType_entityId_idx" ON "GovernanceAudit"("entityType", "entityId");
CREATE INDEX "GovernanceAudit_actor_recordedAt_idx" ON "GovernanceAudit"("actor", "recordedAt");
CREATE INDEX "GovernanceAudit_tenantId_recordedAt_idx" ON "GovernanceAudit"("tenantId", "recordedAt");
CREATE UNIQUE INDEX "ProductionCandidate_candidateKey_key" ON "ProductionCandidate"("candidateKey");
CREATE INDEX "ProductionCandidate_eligible_evaluatedAt_idx" ON "ProductionCandidate"("eligible", "evaluatedAt");
CREATE INDEX "ProductionCandidate_versionId_idx" ON "ProductionCandidate"("versionId");
CREATE INDEX "GovernanceHealthSnapshot_recordedAt_idx" ON "GovernanceHealthSnapshot"("recordedAt");
CREATE INDEX "GovernanceHealthSnapshot_deploymentId_recordedAt_idx" ON "GovernanceHealthSnapshot"("deploymentId", "recordedAt");
CREATE UNIQUE INDEX "EmergencyControl_controlKey_key" ON "EmergencyControl"("controlKey");
CREATE INDEX "EmergencyControl_controlKey_enabled_idx" ON "EmergencyControl"("controlKey", "enabled");
CREATE INDEX "EmergencyControl_scope_enabled_idx" ON "EmergencyControl"("scope", "enabled");
CREATE UNIQUE INDEX "AiGovernanceJobState_jobType_key" ON "AiGovernanceJobState"("jobType");

-- AddForeignKey
ALTER TABLE "ModelVersion" ADD CONSTRAINT "ModelVersion_registryId_fkey" FOREIGN KEY ("registryId") REFERENCES "ModelRegistry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ModelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeploymentHistory" ADD CONSTRAINT "DeploymentHistory_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductionCandidate" ADD CONSTRAINT "ProductionCandidate_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ModelVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
