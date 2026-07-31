import { prisma } from "@/src/server/db/prisma";
import { completeDeployment, createDeployment, resolveApproval } from "@/src/server/ai-governance/ai-governance.repository";
import { compareModelScorecards } from "@/src/server/ai-governance/model-comparison.service";

export async function runShadowDeployment(input: { versionId: string; actor?: string }) {
  const deployment = await createDeployment({
    versionId: input.versionId,
    stage: "SHADOW",
    environment: "shadow",
    actor: input.actor,
  });

  const production = await prisma.modelVersion.findFirst({
    where: { stage: "PRODUCTION" },
    orderBy: { updatedAt: "desc" },
  });

  const comparison = await compareModelScorecards(input.versionId, production?.id);
  const passed = comparison.candidate.score >= comparison.production.score * 0.9;

  const approval = await prisma.approvalRequest.findFirst({
    where: { versionId: input.versionId, approvalType: "REPLAY", status: "PENDING" },
  });
  if (approval && passed) {
    await resolveApproval({ requestId: approval.id, status: "APPROVED", actor: input.actor ?? "shadow-evaluator", comment: "Shadow comparison passed" });
  }

  await completeDeployment(deployment.id, input.actor);
  return { deploymentId: deployment.id, passed, comparison, note: "Shadow mode — no execution, compare only" };
}

export async function evaluateShadowDeployment(deploymentId: string) {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: { version: true },
  });
  if (!deployment || deployment.stage !== "SHADOW") return null;
  const production = await prisma.modelVersion.findFirst({ where: { stage: "PRODUCTION" }, orderBy: { updatedAt: "desc" } });
  return compareModelScorecards(deployment.versionId, production?.id);
}
