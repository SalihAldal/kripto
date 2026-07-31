import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listMarketMemories, listTradeMemories } from "@/src/server/learning-platform/learning-platform.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const type = request.nextUrl.searchParams.get("type") ?? "all";
    const [marketMemories, tradeMemories] = await Promise.all([
      type === "trade" ? [] : listMarketMemories(20),
      type === "market" ? [] : listTradeMemories(50),
    ]);
    return apiOkFromRequest(request, { marketMemories, tradeMemories });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
