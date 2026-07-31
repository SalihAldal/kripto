import { prisma } from "@/src/server/db/prisma";
import { upsertProductionCandidate, appendGovernanceAudit } from "@/src/server/ai-governance/ai-governance.repository";
import { checkAllApprovalsGranted } from "@/src/server/ai-governance/approval-workflow.service";
import { compareModelScorecards } from "@/src/server/ai-governance/model-comparison.service";
import { PROMOTION_REQUIREMENTS } from "@/src/server/ai-governance/ai-governance.types";

export async function evaluatePromotionEligibility(versionId: string) {
  const version = await prisma.modelVersion.findUnique({ where: { id: versionId } });
  if (!version) return null;

  const blockers: string[] = [];

  const researchCandidate = await prisma.productionCandidate.findFirst({ where: { versionId } });
  const shadowDeploy = await prisma.deployment.findFirst({ where: { versionId, stage: "SHADOW", status: "COMPLETED" }, orderBy: { completedAt: "desc" } });
  const canaryDeploy = await prisma.deployment.findFirst({ where: { versionId, stage: "CANARY", status: "COMPLETED", canaryPct: 100 }, orderBy: { completedAt: "desc" } });
  const riskApproval = await prisma.approvalRequest.findFirst({ where: { versionId, approvalType: "RISK", status: "APPROVED" } });
  const governanceApproval = await prisma.approvalRequest.findFirst({ where: { versionId, approvalType: "GOVERNANCE", status: "APPROVED" } });
  const manualApproval = await prisma.approvalRequest.findFirst({ where: { versionId, approvalType: "MANUAL", status: "APPROVED" } });
  const approvalCheck = await checkAllApprovalsGranted(versionId);

  const researchPassed = !!researchCandidate?.researchPassed || !!researchCandidate?.eligible;
  const replayPassed = approvalCheck.approved.includes("REPLAY");
  const shadowPassed = !!shadowDeploy;
  const canaryPassed = !!canaryDeploy;
  const riskPassed = !!riskApproval;
  const governancePassed = !!governanceApproval;
  const manualApproved = !!manualApproval;

  if (!researchPassed) blockers.push("researchNotPassed");
  if (!replayPassed) blockers.push("replayNotPassed");
  if (!shadowPassed) blockers.push("shadowNotPassed");
  if (!canaryPassed) blockers.push("canaryNotPassed");
  if (!riskPassed) blockers.push("riskNotPassed");
  if (!governancePassed) blockers.push("governanceNotPassed");
  if (!manualApproved) blockers.push("manualNotApproved");
  if (!approvalCheck.complete) blockers.push(...approvalCheck.missing.map((m) => `missing_${m}`));

  const scorecard = await compareModelScorecards(versionId);
  const eligible = blockers.length === 0;

  const candidate = await upsertProductionCandidate({
    versionId,
    candidateKey: `candidate_${version.registryId}_${version.versionTag}`,
    researchPassed,
    replayPassed,
    shadowPassed,
    canaryPassed,
    riskPassed,
    governancePassed,
    manualApproved,
    eligible,
    blockers,
    scorecard: scorecard.candidate,
  });

  if (eligible) {
    await appendGovernanceAudit({
      action: "PROMOTION",
      entityType: "ProductionCandidate",
      entityId: candidate.id,
      after: { eligible: true, versionTag: version.versionTag },
    });
  }

  return { eligible, blockers, candidate, requirements: PROMOTION_REQUIREMENTS, scorecard };
}
