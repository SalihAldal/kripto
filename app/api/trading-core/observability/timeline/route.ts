import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getTradingTimeline } from "@/src/server/trading-core/observability/trade-timeline";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(
      request,
      await getTradingTimeline({
        symbol: request.nextUrl.searchParams.get("symbol") ?? undefined,
        positionId: request.nextUrl.searchParams.get("positionId") ?? undefined,
        limit: Number(request.nextUrl.searchParams.get("limit") ?? 120),
      }),
    );
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
