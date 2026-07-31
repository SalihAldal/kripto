import { checkAutomaticRollback } from "@/src/server/ai-governance/automatic-rollback.service";
import { syncAuditIntegrity } from "@/src/server/ai-governance/audit-system.service";
import { advanceDeploymentPipeline } from "@/src/server/ai-governance/deployment-pipeline.service";
import { runCanaryDeployment } from "@/src/server/ai-governance/canary-deployment.service";
import { runShadowDeployment } from "@/src/server/ai-governance/shadow-deployment.service";
import { processApproval, requestFullApprovalChain } from "@/src/server/ai-governance/approval-workflow.service";
import { monitorProductionHealth } from "@/src/server/ai-governance/production-health.service";
import { evaluatePromotionEligibility } from "@/src/server/ai-governance/promotion-rules.service";
import { validateConfiguration } from "@/src/server/ai-governance/configuration-management.service";
import { seedDefaultRegistry } from "@/src/server/ai-governance/ai-registry.service";
import { seedEmergencyControls } from "@/src/server/ai-governance/emergency-controls.service";
import { listFeatureFlags } from "@/src/server/ai-governance/feature-flags.service";
import type { AiGovernanceJobPayload } from "@/src/server/ai-governance/ai-governance.types";

export async function runAiGovernanceJob(payload: AiGovernanceJobPayload) {
  switch (payload.type) {
    case "DEPLOYMENT_PROCESS":
      if (payload.versionId && payload.stage) {
        return advanceDeploymentPipeline({ versionId: payload.versionId, targetStage: payload.stage });
      }
      await seedDefaultRegistry();
      return { seeded: true };
    case "ROLLBACK_CHECK":
      return checkAutomaticRollback(payload.deploymentId);
    case "APPROVAL_PROCESS":
      if (payload.requestId) {
        return processApproval({ requestId: payload.requestId, status: "APPROVED", actor: "governance-worker" });
      }
      return requestFullApprovalChain({ versionId: payload.versionId ?? "", requestedBy: "governance-worker" });
    case "HEALTH_MONITOR":
      return monitorProductionHealth(payload.deploymentId);
    case "GOVERNANCE_MONITOR":
      await seedEmergencyControls();
      return listFeatureFlags();
    case "AUDIT_SYNC":
      return syncAuditIntegrity(payload.limit);
    case "CANARY_EVALUATE":
      if (payload.deploymentId) {
        const { advanceCanaryStep } = await import("@/src/server/ai-governance/canary-deployment.service");
        return advanceCanaryStep(payload.deploymentId);
      }
      if (payload.versionId) return runCanaryDeployment({ versionId: payload.versionId, targetPct: payload.targetPct });
      return null;
    case "SHADOW_EVALUATE":
      if (payload.deploymentId) {
        const { evaluateShadowDeployment } = await import("@/src/server/ai-governance/shadow-deployment.service");
        return evaluateShadowDeployment(payload.deploymentId);
      }
      if (payload.versionId) return runShadowDeployment({ versionId: payload.versionId });
      return null;
    case "FEATURE_FLAG_SYNC":
      return listFeatureFlags();
    case "CONFIG_VALIDATE":
      return validateConfiguration({});
    case "PROMOTION_EVALUATE":
      if (payload.candidateId) {
        const { prisma } = await import("@/src/server/db/prisma");
        const c = await prisma.productionCandidate.findUnique({ where: { id: payload.candidateId } });
        if (c) return evaluatePromotionEligibility(c.versionId);
      }
      if (payload.versionId) return evaluatePromotionEligibility(payload.versionId);
      return null;
    default:
      return { skipped: true };
  }
}
