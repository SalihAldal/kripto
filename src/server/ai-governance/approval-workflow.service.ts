import { prisma } from "@/src/server/db/prisma";
import { createApprovalRequest, resolveApproval } from "@/src/server/ai-governance/ai-governance.repository";
import { REQUIRED_APPROVALS } from "@/src/server/ai-governance/ai-governance.types";
import { emitAiGovernanceEvent, GOVERNANCE_EVENT } from "@/src/server/ai-governance/ai-governance.events";
import type { ApprovalType } from "@prisma/client";

export async function requestFullApprovalChain(input: { versionId: string; deploymentId?: string; requestedBy?: string }) {
  const requests = [];
  for (const approvalType of REQUIRED_APPROVALS) {
    requests.push(
      await createApprovalRequest({
        versionId: input.versionId,
        deploymentId: input.deploymentId,
        approvalType,
        requestedBy: input.requestedBy,
        rationale: `Required ${approvalType} approval for production promotion`,
      }),
    );
  }
  return { requested: requests.length, requests };
}

export async function processApproval(input: {
  requestId: string;
  status: "APPROVED" | "REJECTED";
  actor: string;
  comment?: string;
  roles?: string[];
}) {
  const request = await prisma.approvalRequest.findUnique({ where: { id: input.requestId } });
  if (!request) return null;

  const allowed = canApprove(request.approvalType, input.roles ?? []);
  if (!allowed) return { error: "Insufficient permissions", approvalType: request.approvalType };

  const row = await resolveApproval(input);
  emitAiGovernanceEvent(
    input.status === "APPROVED" ? GOVERNANCE_EVENT.APPROVAL_GRANTED : GOVERNANCE_EVENT.APPROVAL_REJECTED,
    { requestId: input.requestId, approvalType: request.approvalType, actor: input.actor },
  );
  return row;
}

function canApprove(approvalType: ApprovalType, roles: string[]) {
  if (roles.includes("ADMIN")) return true;
  if (approvalType === "MANUAL") return false;
  if (approvalType === "GOVERNANCE") return roles.includes("ADMIN");
  if (approvalType === "RISK") return roles.includes("ADMIN");
  if (approvalType === "RESEARCH" && roles.includes("TRADER")) return true;
  if (approvalType === "REPLAY" && roles.includes("TRADER")) return true;
  if (approvalType === "PERFORMANCE" && roles.includes("TRADER")) return true;
  return false;
}

export async function getApprovalQueue(status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING") {
  return prisma.approvalRequest.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    include: { history: { orderBy: { recordedAt: "desc" }, take: 3 } },
  });
}

export async function checkAllApprovalsGranted(versionId: string) {
  const rows = await prisma.approvalRequest.findMany({ where: { versionId, status: "APPROVED" } });
  const approved = new Set(rows.map((r) => r.approvalType));
  const missing = REQUIRED_APPROVALS.filter((t) => !approved.has(t));
  return { complete: missing.length === 0, missing, approved: [...approved] };
}
