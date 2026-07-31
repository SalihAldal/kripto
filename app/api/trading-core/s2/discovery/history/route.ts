import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listDiscoverySnapshots } from "@/src/server/trading-core-s2/trading-core-s2.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const history = await listDiscoverySnapshots(Number.isFinite(limit) ? Math.min(limit, 100) : 30);
    return apiOkFromRequest(request, { history });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
