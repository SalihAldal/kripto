import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { GovernanceAuditAction, ModelScorecard } from "@/src/server/ai-governance/ai-governance.types";

export function computeAuditChecksum(payload: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function appendGovernanceAudit(input: {
  action: GovernanceAuditAction;
  entityType: string;
  entityId?: string;
  actor?: string;
  tenantId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const checksum = computeAuditChecksum({ ...input, recordedAt: new Date().toISOString() });
  return prisma.governanceAudit.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actor: input.actor,
      tenantId: input.tenantId,
      before: input.before as Prisma.InputJsonValue,
      after: input.after as Prisma.InputJsonValue,
      checksum,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function registerModel(input: {
  registryKey: string;
  name: string;
  registryType: Parameters<typeof prisma.modelRegistry.create>[0]["data"]["registryType"];
  description?: string;
  owner?: string;
  tenantId?: string;
  exchange?: string;
  accountId?: string;
  region?: string;
  fundId?: string;
  clientId?: string;
  metadata?: Record<string, unknown>;
  actor?: string;
}) {
  const row = await prisma.modelRegistry.upsert({
    where: { registryKey: input.registryKey },
    create: {
      registryKey: input.registryKey,
      name: input.name,
      registryType: input.registryType,
      description: input.description,
      owner: input.owner,
      tenantId: input.tenantId,
      exchange: input.exchange,
      accountId: input.accountId,
      region: input.region,
      fundId: input.fundId,
      clientId: input.clientId,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
    update: {
      name: input.name,
      description: input.description,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
  await appendGovernanceAudit({
    action: "REGISTER",
    entityType: "ModelRegistry",
    entityId: row.id,
    actor: input.actor,
    tenantId: input.tenantId,
    after: { registryKey: row.registryKey, registryType: row.registryType },
  });
  return row;
}

export async function createModelVersion(input: {
  registryId: string;
  versionTag: string;
  stage?: Parameters<typeof prisma.modelVersion.create>[0]["data"]["stage"];
  semverMajor?: number;
  semverMinor?: number;
  semverPatch?: number;
  changelog?: string;
  config?: Record<string, unknown>;
  actor?: string;
}) {
  const artifactHash = computeAuditChecksum(input.config ?? { tag: input.versionTag });
  const row = await prisma.modelVersion.create({
    data: {
      registryId: input.registryId,
      versionTag: input.versionTag,
      stage: input.stage ?? "EXPERIMENTAL",
      semverMajor: input.semverMajor ?? 1,
      semverMinor: input.semverMinor ?? 0,
      semverPatch: input.semverPatch ?? 0,
      changelog: input.changelog,
      artifactHash,
      config: input.config as Prisma.InputJsonValue,
    },
  });
  await appendGovernanceAudit({
    action: "VERSION_CREATE",
    entityType: "ModelVersion",
    entityId: row.id,
    actor: input.actor,
    after: { versionTag: row.versionTag, stage: row.stage },
  });
  return row;
}

export async function createDeployment(input: {
  versionId: string;
  stage: Parameters<typeof prisma.deployment.create>[0]["data"]["stage"];
  environment?: string;
  canaryPct?: number;
  exchange?: string;
  accountId?: string;
  tenantId?: string;
  actor?: string;
}) {
  const deploymentKey = `dep_${input.stage.toLowerCase()}_${Date.now()}`;
  const row = await prisma.deployment.create({
    data: {
      versionId: input.versionId,
      deploymentKey,
      stage: input.stage,
      status: "IN_PROGRESS",
      canaryPct: input.canaryPct,
      environment: input.environment ?? "development",
      exchange: input.exchange,
      accountId: input.accountId,
      tenantId: input.tenantId,
      startedAt: new Date(),
    },
  });
  await recordDeploymentHistory({
    deploymentId: row.id,
    toStage: input.stage,
    toStatus: "IN_PROGRESS",
    canaryPct: input.canaryPct,
    actor: input.actor,
  });
  await appendGovernanceAudit({
    action: "DEPLOY_START",
    entityType: "Deployment",
    entityId: row.id,
    actor: input.actor,
    after: { stage: row.stage, canaryPct: row.canaryPct },
  });
  return row;
}

export async function completeDeployment(deploymentId: string, actor?: string) {
  const row = await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  await recordDeploymentHistory({ deploymentId, toStage: row.stage, toStatus: "COMPLETED", actor });
  await appendGovernanceAudit({ action: "DEPLOY_COMPLETE", entityType: "Deployment", entityId: deploymentId, actor });
  return row;
}

export async function failDeployment(deploymentId: string, reason?: string, actor?: string) {
  const row = await prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: "FAILED", completedAt: new Date(), metadata: { reason } as Prisma.InputJsonValue },
  });
  await recordDeploymentHistory({ deploymentId, toStage: row.stage, toStatus: "FAILED", actor, reason });
  await appendGovernanceAudit({ action: "DEPLOY_FAIL", entityType: "Deployment", entityId: deploymentId, actor, metadata: { reason } });
  return row;
}

export async function recordDeploymentHistory(input: {
  deploymentId: string;
  fromStage?: Parameters<typeof prisma.deploymentHistory.create>[0]["data"]["fromStage"];
  toStage: Parameters<typeof prisma.deploymentHistory.create>[0]["data"]["toStage"];
  fromStatus?: Parameters<typeof prisma.deploymentHistory.create>[0]["data"]["fromStatus"];
  toStatus: Parameters<typeof prisma.deploymentHistory.create>[0]["data"]["toStatus"];
  canaryPct?: number;
  actor?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.deploymentHistory.create({ data: { ...input, metadata: input.metadata as Prisma.InputJsonValue } });
}

export async function createApprovalRequest(input: {
  versionId?: string;
  deploymentId?: string;
  approvalType: Parameters<typeof prisma.approvalRequest.create>[0]["data"]["approvalType"];
  requestedBy?: string;
  rationale?: string;
}) {
  return prisma.approvalRequest.create({
    data: {
      versionId: input.versionId,
      deploymentId: input.deploymentId,
      approvalType: input.approvalType,
      requestedBy: input.requestedBy,
      rationale: input.rationale,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    },
  });
}

export async function resolveApproval(input: {
  requestId: string;
  status: "APPROVED" | "REJECTED";
  actor?: string;
  comment?: string;
}) {
  const row = await prisma.approvalRequest.update({
    where: { id: input.requestId },
    data: { status: input.status },
  });
  await prisma.approvalHistory.create({
    data: { approvalRequestId: input.requestId, status: input.status, actor: input.actor, comment: input.comment },
  });
  await appendGovernanceAudit({
    action: input.status === "APPROVED" ? "APPROVAL_GRANT" : "APPROVAL_REJECT",
    entityType: "ApprovalRequest",
    entityId: input.requestId,
    actor: input.actor,
    after: { status: input.status, approvalType: row.approvalType },
  });
  return row;
}

export async function recordRollback(input: {
  deploymentId?: string;
  versionId?: string;
  reason: Parameters<typeof prisma.rollbackHistory.create>[0]["data"]["reason"];
  triggerType?: string;
  actor?: string;
  fromVersion?: string;
  toVersion?: string;
  metrics?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const row = await prisma.rollbackHistory.create({
    data: {
      deploymentId: input.deploymentId,
      versionId: input.versionId,
      reason: input.reason,
      triggerType: input.triggerType,
      actor: input.actor,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      metrics: input.metrics as Prisma.InputJsonValue,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
  if (input.deploymentId) {
    await prisma.deployment.update({
      where: { id: input.deploymentId },
      data: { status: "ROLLED_BACK", rolledBackAt: new Date(), stage: "ROLLBACK" },
    });
  }
  await appendGovernanceAudit({
    action: "ROLLBACK",
    entityType: "Deployment",
    entityId: input.deploymentId,
    actor: input.actor,
    metadata: { reason: input.reason, metrics: input.metrics },
  });
  return row;
}

export async function upsertFeatureFlag(input: {
  flagKey: string;
  name: string;
  status: Parameters<typeof prisma.featureFlag.upsert>[0]["create"]["status"];
  rolloutPct?: number;
  environment?: string;
  exchange?: string;
  accountId?: string;
  tenantId?: string;
  abVariant?: string;
  actor?: string;
}) {
  const row = await prisma.featureFlag.upsert({
    where: {
      flagKey_environment_exchange_accountId_tenantId: {
        flagKey: input.flagKey,
        environment: input.environment ?? "production",
        exchange: input.exchange ?? "",
        accountId: input.accountId ?? "",
        tenantId: input.tenantId ?? "",
      },
    },
    create: {
      flagKey: input.flagKey,
      name: input.name,
      status: input.status,
      rolloutPct: input.rolloutPct ?? 0,
      environment: input.environment ?? "production",
      exchange: input.exchange,
      accountId: input.accountId,
      tenantId: input.tenantId,
      abVariant: input.abVariant,
      enabledAt: input.status === "ENABLED" ? new Date() : undefined,
    },
    update: {
      status: input.status,
      rolloutPct: input.rolloutPct,
      enabledAt: input.status === "ENABLED" ? new Date() : undefined,
      disabledAt: input.status === "DISABLED" ? new Date() : undefined,
    },
  });
  await appendGovernanceAudit({
    action: input.status === "ENABLED" || input.status === "PARTIAL" ? "FEATURE_ENABLE" : "FEATURE_DISABLE",
    entityType: "FeatureFlag",
    entityId: row.id,
    actor: input.actor,
    after: { flagKey: row.flagKey, status: row.status, rolloutPct: row.rolloutPct },
  });
  return row;
}

export async function createConfigurationVersion(input: {
  configKey: string;
  domain: Parameters<typeof prisma.configurationVersion.create>[0]["data"]["domain"];
  versionTag: string;
  config: Record<string, unknown>;
  environment?: string;
  tenantId?: string;
  exchange?: string;
  accountId?: string;
  actor?: string;
}) {
  const checksum = computeAuditChecksum(input.config);
  const row = await prisma.configurationVersion.create({
    data: {
      configKey: input.configKey,
      domain: input.domain,
      versionTag: input.versionTag,
      config: input.config as Prisma.InputJsonValue,
      checksum,
      environment: input.environment ?? "production",
      tenantId: input.tenantId,
      exchange: input.exchange,
      accountId: input.accountId,
    },
  });
  await appendGovernanceAudit({
    action: "CONFIG_UPDATE",
    entityType: "ConfigurationVersion",
    entityId: row.id,
    actor: input.actor,
    after: { configKey: row.configKey, versionTag: row.versionTag, checksum },
  });
  return row;
}

export async function upsertProductionCandidate(input: {
  versionId: string;
  candidateKey: string;
  researchPassed?: boolean;
  replayPassed?: boolean;
  shadowPassed?: boolean;
  canaryPassed?: boolean;
  riskPassed?: boolean;
  governancePassed?: boolean;
  manualApproved?: boolean;
  eligible?: boolean;
  blockers?: string[];
  scorecard?: ModelScorecard;
}) {
  return prisma.productionCandidate.upsert({
    where: { candidateKey: input.candidateKey },
    create: {
      versionId: input.versionId,
      candidateKey: input.candidateKey,
      researchPassed: input.researchPassed ?? false,
      replayPassed: input.replayPassed ?? false,
      shadowPassed: input.shadowPassed ?? false,
      canaryPassed: input.canaryPassed ?? false,
      riskPassed: input.riskPassed ?? false,
      governancePassed: input.governancePassed ?? false,
      manualApproved: input.manualApproved ?? false,
      eligible: input.eligible ?? false,
      blockers: input.blockers as Prisma.InputJsonValue,
      scorecard: input.scorecard as unknown as Prisma.InputJsonValue,
      evaluatedAt: new Date(),
    },
    update: {
      researchPassed: input.researchPassed,
      replayPassed: input.replayPassed,
      shadowPassed: input.shadowPassed,
      canaryPassed: input.canaryPassed,
      riskPassed: input.riskPassed,
      governancePassed: input.governancePassed,
      manualApproved: input.manualApproved,
      eligible: input.eligible,
      blockers: input.blockers as Prisma.InputJsonValue,
      scorecard: input.scorecard as unknown as Prisma.InputJsonValue,
      evaluatedAt: new Date(),
    },
  });
}

export async function recordHealthSnapshot(input: {
  profitFactor?: number;
  winRate?: number;
  expectancy?: number;
  maxDrawdownPct?: number;
  executionSuccess?: number;
  riskScore?: number;
  portfolioHealth?: number;
  decisionAccuracy?: number;
  rejectAccuracy?: number;
  deploymentId?: string;
  versionId?: string;
}) {
  return prisma.governanceHealthSnapshot.create({ data: input });
}

export async function upsertEmergencyControl(input: {
  controlKey: string;
  name: string;
  enabled: boolean;
  scope?: string;
  environment?: string;
  exchange?: string;
  accountId?: string;
  tenantId?: string;
  reason?: string;
  actor?: string;
}) {
  const row = await prisma.emergencyControl.upsert({
    where: { controlKey: input.controlKey },
    create: {
      controlKey: input.controlKey,
      name: input.name,
      enabled: input.enabled,
      scope: input.scope ?? "GLOBAL",
      environment: input.environment,
      exchange: input.exchange,
      accountId: input.accountId,
      tenantId: input.tenantId,
      reason: input.reason,
      actor: input.actor,
      activatedAt: input.enabled ? new Date() : undefined,
    },
    update: {
      enabled: input.enabled,
      reason: input.reason,
      actor: input.actor,
      activatedAt: input.enabled ? new Date() : undefined,
    },
  });
  await appendGovernanceAudit({
    action: "EMERGENCY",
    entityType: "EmergencyControl",
    entityId: row.id,
    actor: input.actor,
    after: { controlKey: row.controlKey, enabled: row.enabled },
  });
  return row;
}

export async function getGovernanceDashboard() {
  const [registries, deployments, approvals, rollbacks, flags, configs, candidates, health, audits] = await Promise.all([
    prisma.modelRegistry.findMany({ orderBy: { updatedAt: "desc" }, take: 30, include: { versions: { take: 3, orderBy: { createdAt: "desc" } } } }),
    prisma.deployment.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { version: { include: { registry: true } } } }),
    prisma.approvalRequest.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.rollbackHistory.findMany({ orderBy: { rolledBackAt: "desc" }, take: 20 }),
    prisma.featureFlag.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.configurationVersion.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" }, take: 30 }),
    prisma.productionCandidate.findMany({ orderBy: { evaluatedAt: "desc" }, take: 20, include: { version: true } }),
    prisma.governanceHealthSnapshot.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.governanceAudit.findMany({ orderBy: { recordedAt: "desc" }, take: 50 }),
  ]);
  return { registries, deployments, approvals, rollbacks, flags, configs, candidates, health, audits };
}

export async function listAuditLog(limit = 100, entityType?: string) {
  return prisma.governanceAudit.findMany({
    where: entityType ? { entityType } : undefined,
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
}
