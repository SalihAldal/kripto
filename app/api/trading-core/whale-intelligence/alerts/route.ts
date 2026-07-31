import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listActiveAlerts } from "@/src/server/whale-intelligence/whale-intelligence.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const alerts = await listActiveAlerts(limit);
    return apiOkFromRequest(request, { alerts, count: alerts.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
