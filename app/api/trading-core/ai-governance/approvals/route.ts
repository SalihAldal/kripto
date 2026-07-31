import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getApprovalQueue, processApproval, requestFullApprovalChain, checkAllApprovalsGranted } from "@/src/server/ai-governance/approval-workflow.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const versionId = request.nextUrl.searchParams.get("versionId");
    if (versionId) return apiOkFromRequest(request, await checkAllApprovalsGranted(versionId));
    const status = (request.nextUrl.searchParams.get("status") ?? "PENDING") as "PENDING" | "APPROVED" | "REJECTED";
    return apiOkFromRequest(request, await getApprovalQueue(status));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json();
    if (body.requestChain) return apiOkFromRequest(request, await requestFullApprovalChain(body));
    return apiOkFromRequest(request, await processApproval({ ...body, roles: [access.user.role] }));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
