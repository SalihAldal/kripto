import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listExchangeFlows } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { getExchangeFlowSummary } from "@/src/server/whale-intelligence/exchange-flow.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const exchange = request.nextUrl.searchParams.get("exchange") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const [flows, summary] = await Promise.all([
      listExchangeFlows(exchange, limit),
      getExchangeFlowSummary(exchange),
    ]);
    return apiOkFromRequest(request, { flows, summary, count: flows.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
