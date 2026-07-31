import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  listExecutionAudits,
  listExecutionFailures,
  listExecutionReconciliations,
} from "@/src/server/execution-engine-v2/execution-engine-v2.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const [audits, failures, reconciliations] = await Promise.all([
      listExecutionAudits(limit),
      listExecutionFailures(limit),
      listExecutionReconciliations(limit),
    ]);
    return apiOkFromRequest(request, { audits, failures, reconciliations });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
