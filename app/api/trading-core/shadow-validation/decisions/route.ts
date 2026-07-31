import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listShadowDecisions } from "@/src/server/shadow-validation/shadow-validation.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const rows = await listShadowDecisions({
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 100),
      engineId: request.nextUrl.searchParams.get("engineId") ?? undefined,
      decisionId: request.nextUrl.searchParams.get("decisionId") ?? undefined,
    });
    return apiOkFromRequest(request, { rows, count: rows.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
