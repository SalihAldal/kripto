import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listBridgeMetrics } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const bridges = await listBridgeMetrics(limit);
    return apiOkFromRequest(request, { bridges, count: bridges.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
