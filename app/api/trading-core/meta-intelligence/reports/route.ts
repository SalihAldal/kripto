import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listExecutiveReports } from "@/src/server/meta-intelligence/meta-intelligence.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const reportType = request.nextUrl.searchParams.get("type") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const reports = await listExecutiveReports(reportType, limit);
    return apiOkFromRequest(request, { reports, count: reports.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
