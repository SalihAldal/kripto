import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getFeatureLeaderboard, getFeatureRanking } from "@/src/server/quant-research/feature-research.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const experimentId = request.nextUrl.searchParams.get("experimentId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const view = request.nextUrl.searchParams.get("view");
    if (view === "leaderboard") {
      return apiOkFromRequest(request, await getFeatureLeaderboard());
    }
    return apiOkFromRequest(request, await getFeatureRanking(limit, experimentId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
