import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listExitAnalyses } from "@/src/server/exit-timing/exit-timing.repository";
import { analyzeExitTiming, scanAllOpenPositions } from "@/src/server/exit-timing/exit-analysis.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const analyses = await listExitAnalyses(symbol);
    return apiOkFromRequest(request, { analyses });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { symbol?: string; positionId?: string; scanAll?: boolean };
    if (body.scanAll) {
      const result = await scanAllOpenPositions();
      return apiOkFromRequest(request, result);
    }
    const result = await analyzeExitTiming({ symbol: body.symbol, positionId: body.positionId });
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
