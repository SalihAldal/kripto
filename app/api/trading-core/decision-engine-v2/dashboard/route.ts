import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getDecisionEngineV2Dashboard } from "@/src/server/decision-engine-v2/decision-engine-v2.orchestrator";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const dashboard = await getDecisionEngineV2Dashboard();
    return apiOkFromRequest(request, dashboard);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
