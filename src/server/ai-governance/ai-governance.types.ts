import type {
  AiGovernanceJobType,
  ApprovalStatus,
  ApprovalType,
  ConfigDomain,
  DeploymentStage,
  DeploymentStatus,
  FeatureFlagStatus,
  GovernanceAuditAction,
  ModelRegistryType,
  RollbackReason,
  VersionStage,
} from "@prisma/client";

export type AiGovernanceJobPayload =
  | { type: "DEPLOYMENT_PROCESS"; deploymentId?: string; versionId?: string; stage?: DeploymentStage }
  | { type: "ROLLBACK_CHECK"; deploymentId?: string }
  | { type: "APPROVAL_PROCESS"; requestId?: string; versionId?: string }
  | { type: "HEALTH_MONITOR"; deploymentId?: string }
  | { type: "GOVERNANCE_MONITOR" }
  | { type: "AUDIT_SYNC"; limit?: number }
  | { type: "CANARY_EVALUATE"; deploymentId?: string; versionId?: string; targetPct?: number }
  | { type: "SHADOW_EVALUATE"; deploymentId?: string; versionId?: string }
  | { type: "FEATURE_FLAG_SYNC" }
  | { type: "CONFIG_VALIDATE"; configKey?: string }
  | { type: "PROMOTION_EVALUATE"; versionId?: string; candidateId?: string };

export const CANARY_STEPS = [1, 5, 10, 25, 50, 100] as const;

export const DEPLOYMENT_PIPELINE: DeploymentStage[] = [
  "DEVELOPMENT",
  "TESTING",
  "PAPER",
  "SHADOW",
  "CANARY",
  "STAGING",
  "PRODUCTION",
];

export const REQUIRED_APPROVALS: ApprovalType[] = [
  "RESEARCH",
  "REPLAY",
  "RISK",
  "PERFORMANCE",
  "GOVERNANCE",
  "MANUAL",
];

export const PROMOTION_REQUIREMENTS = {
  researchPassed: true,
  replayPassed: true,
  shadowPassed: true,
  canaryPassed: true,
  riskPassed: true,
  governancePassed: true,
  manualApproved: true,
} as const;

export const ROLLBACK_THRESHOLDS = {
  profitFactorDropPct: 15,
  winRateDropPct: 10,
  maxDrawdownPct: 8,
  riskIncreasePct: 20,
  confidenceDropPct: 25,
  executionErrorRatePct: 5,
} as const;

export const GOVERNANCE_EVENT = {
  DEPLOYMENT_STARTED: "DeploymentStarted",
  DEPLOYMENT_COMPLETED: "DeploymentCompleted",
  DEPLOYMENT_FAILED: "DeploymentFailed",
  ROLLBACK_STARTED: "RollbackStarted",
  ROLLBACK_COMPLETED: "RollbackCompleted",
  APPROVAL_GRANTED: "ApprovalGranted",
  APPROVAL_REJECTED: "ApprovalRejected",
  FEATURE_ENABLED: "FeatureEnabled",
  FEATURE_DISABLED: "FeatureDisabled",
} as const;

export type ModelScorecard = {
  versionId: string;
  versionTag: string;
  stage: VersionStage;
  profitFactor?: number;
  winRate?: number;
  sharpe?: number;
  maxDrawdownPct?: number;
  score: number;
};

export type { AiGovernanceJobType, ApprovalStatus, ApprovalType, ConfigDomain, DeploymentStage, DeploymentStatus, FeatureFlagStatus, GovernanceAuditAction, ModelRegistryType, RollbackReason, VersionStage };
