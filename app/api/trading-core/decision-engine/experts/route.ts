import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listExpertOpinions } from "@/src/server/decision-engine/decision-engine.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const decisionId = request.nextUrl.searchParams.get("decisionId");
    if (!decisionId) return apiOkFromRequest(request, { error: "decisionId required" });
    const rows = await listExpertOpinions(decisionId);
    return apiOkFromRequest(request, { rows, count: rows.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
