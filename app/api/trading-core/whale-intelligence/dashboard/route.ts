import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getWhaleDashboard } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { calculateFlowIntelligence } from "@/src/server/whale-intelligence/flow-intelligence.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, flowSummary] = await Promise.all([
      getWhaleDashboard(),
      calculateFlowIntelligence(100),
    ]);
    return apiOkFromRequest(request, { ...dashboard, flowSummary });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
