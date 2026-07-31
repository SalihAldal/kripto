import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { detectMarketRegime } from "@/src/server/strategy-selector/regime-detection.service";
import { getLatestRegime } from "@/src/server/strategy-selector/strategy-selector.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const regime = await getLatestRegime(symbol ?? undefined);
    return apiOkFromRequest(request, { regime });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { symbol?: string };
    const regime = await detectMarketRegime(body.symbol);
    return apiOkFromRequest(request, { regime });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
