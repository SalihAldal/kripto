import { prisma } from "@/src/server/db/prisma";
import {
  completeDeployment,
  createApprovalRequest,
  createDeployment,
  failDeployment,
  recordDeploymentHistory,
} from "@/src/server/ai-governance/ai-governance.repository";
import { DEPLOYMENT_PIPELINE } from "@/src/server/ai-governance/ai-governance.types";
import { emitAiGovernanceEvent, GOVERNANCE_EVENT } from "@/src/server/ai-governance/ai-governance.events";
import type { DeploymentStage } from "@prisma/client";

export async function advanceDeploymentPipeline(input: {
  versionId: string;
  targetStage: DeploymentStage;
  environment?: string;
  actor?: string;
}) {
  emitAiGovernanceEvent(GOVERNANCE_EVENT.DEPLOYMENT_STARTED, { versionId: input.versionId, stage: input.targetStage });

  const idx = DEPLOYMENT_PIPELINE.indexOf(input.targetStage);
  if (idx < 0) throw new Error(`Invalid stage: ${input.targetStage}`);

  if (input.targetStage === "PRODUCTION") {
    const approvals = await prisma.approvalRequest.findMany({
      where: { versionId: input.versionId, status: "APPROVED" },
    });
    const required = ["RESEARCH", "REPLAY", "RISK", "PERFORMANCE", "GOVERNANCE", "MANUAL"];
    const approved = new Set(approvals.map((a) => a.approvalType));
    const missing = required.filter((t) => !approved.has(t as never));
    if (missing.length > 0) {
      await failDeployment(
        (await createDeployment({ versionId: input.versionId, stage: input.targetStage, environment: input.environment, actor: input.actor })).id,
        `Missing approvals: ${missing.join(", ")}`,
        input.actor,
      );
      emitAiGovernanceEvent(GOVERNANCE_EVENT.DEPLOYMENT_FAILED, { versionId: input.versionId, missing });
      return { success: false, missing };
    }
  }

  const deployment = await createDeployment({
    versionId: input.versionId,
    stage: input.targetStage,
    environment: input.environment ?? input.targetStage.toLowerCase(),
    actor: input.actor,
  });

  if (input.targetStage === "SHADOW" || input.targetStage === "PAPER") {
    await createApprovalRequest({ versionId: input.versionId, deploymentId: deployment.id, approvalType: "REPLAY", requestedBy: input.actor }).catch(() => null);
  }

  await completeDeployment(deployment.id, input.actor);
  emitAiGovernanceEvent(GOVERNANCE_EVENT.DEPLOYMENT_COMPLETED, { deploymentId: deployment.id, stage: input.targetStage });
  return { success: true, deployment };
}

export async function getDeploymentTimeline(deploymentId: string) {
  return prisma.deploymentHistory.findMany({
    where: { deploymentId },
    orderBy: { recordedAt: "asc" },
  });
}

export async function rollbackDeployment(deploymentId: string, actor?: string, reason?: string) {
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment) return null;
  await recordDeploymentHistory({
    deploymentId,
    fromStage: deployment.stage,
    toStage: "ROLLBACK",
    fromStatus: deployment.status,
    toStatus: "ROLLED_BACK",
    actor,
    reason,
  });
  return prisma.deployment.update({
    where: { id: deploymentId },
    data: { status: "ROLLED_BACK", stage: "ROLLBACK", rolledBackAt: new Date() },
  });
}
