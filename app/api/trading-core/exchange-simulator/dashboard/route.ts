import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getSimulatorDashboardMetrics } from "@/src/server/exchange-simulator/exchange-simulator.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const periodHours = Number(request.nextUrl.searchParams.get("periodHours") ?? 24);
    return apiOkFromRequest(request, await getSimulatorDashboardMetrics(Number.isFinite(periodHours) ? periodHours : 24));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
