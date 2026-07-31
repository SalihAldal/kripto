import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { listStrategyConfigVersions } from "@/src/server/config/strategy-config.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  try {
    const tr = getRequestLocale(request) === "tr";
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "30");
    const rows = await listStrategyConfigVersions(limit);
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
