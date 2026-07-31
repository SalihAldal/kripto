import { prisma } from "@/src/server/db/prisma";
import {
  completeDeployment,
  createDeployment,
  recordDeploymentHistory,
} from "@/src/server/ai-governance/ai-governance.repository";
import { CANARY_STEPS } from "@/src/server/ai-governance/ai-governance.types";
import { compareModelScorecards } from "@/src/server/ai-governance/model-comparison.service";

export async function runCanaryDeployment(input: { versionId: string; targetPct?: number; actor?: string }) {
  const targetPct = input.targetPct ?? CANARY_STEPS[0]!;
  const deployment = await createDeployment({
    versionId: input.versionId,
    stage: "CANARY",
    environment: "production",
    canaryPct: targetPct,
    actor: input.actor,
  });

  const production = await prisma.modelVersion.findFirst({
    where: { registry: { versions: { some: { stage: "PRODUCTION" } } }, stage: "PRODUCTION" },
    include: { registry: true },
  });

  const comparison = await compareModelScorecards(input.versionId, production?.id);
  const passed = comparison.candidate.score >= comparison.production.score * 0.95;

  await recordDeploymentHistory({
    deploymentId: deployment.id,
    toStage: "CANARY",
    toStatus: passed ? "COMPLETED" : "FAILED",
    canaryPct: targetPct,
    actor: input.actor,
    reason: passed ? "Canary metrics acceptable" : "Canary underperformed production",
    metadata: comparison as never,
  });

  if (passed) {
    await completeDeployment(deployment.id, input.actor);
    const nextIdx = CANARY_STEPS.indexOf(targetPct as (typeof CANARY_STEPS)[number]) + 1;
    if (nextIdx < CANARY_STEPS.length) {
      return { deploymentId: deployment.id, canaryPct: targetPct, passed, nextPct: CANARY_STEPS[nextIdx] };
    }
    return { deploymentId: deployment.id, canaryPct: 100, passed, readyForProduction: true };
  }

  return { deploymentId: deployment.id, canaryPct: targetPct, passed: false, comparison };
}

export async function advanceCanaryStep(deploymentId: string, actor?: string) {
  const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
  if (!deployment || deployment.stage !== "CANARY") return null;
  const current = deployment.canaryPct ?? 1;
  const next = CANARY_STEPS.find((s) => s > current) ?? 100;
  return runCanaryDeployment({ versionId: deployment.versionId, targetPct: next, actor });
}
