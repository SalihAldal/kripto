import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  fetchDecisionLog,
  fetchDecisionLogs,
} from "@/src/server/observability/decision-observability.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const decisionId = request.nextUrl.searchParams.get("decisionId");
    if (decisionId) {
      const row = await fetchDecisionLog(decisionId);
      return apiOkFromRequest(request, row);
    }

    const sinceRaw = request.nextUrl.searchParams.get("since");
    const since = sinceRaw ? new Date(sinceRaw) : undefined;
    const rows = await fetchDecisionLogs({
      symbol: request.nextUrl.searchParams.get("symbol") ?? undefined,
      decision: request.nextUrl.searchParams.get("decision") ?? undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 100),
      since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    });
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
