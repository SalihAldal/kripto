import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listSupplyMetrics } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { getSupplySummary } from "@/src/server/onchain-intelligence/supply-intelligence.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const asset = request.nextUrl.searchParams.get("asset") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const [metrics, summary] = await Promise.all([
      listSupplyMetrics(asset, limit),
      getSupplySummary(asset),
    ]);
    return apiOkFromRequest(request, { metrics, summary, count: metrics.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
