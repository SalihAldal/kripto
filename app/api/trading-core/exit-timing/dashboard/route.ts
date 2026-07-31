import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getExitDashboard, getProfitProtectionTimeline } from "@/src/server/exit-timing/exit-timing.repository";
import { getBestAndWorstExits } from "@/src/server/exit-timing/exit-learning.service";
import { PARTIAL_EXIT_ARCH, TRAILING_ARCH } from "@/src/server/exit-timing/exit-timing.types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const positionId = request.nextUrl.searchParams.get("positionId") ?? undefined;
    const [dashboard, protections, patterns] = await Promise.all([
      getExitDashboard(),
      getProfitProtectionTimeline(positionId),
      getBestAndWorstExits(),
    ]);
    return apiOkFromRequest(request, {
      bestExits: dashboard.bestExits,
      worstExits: dashboard.worstExits,
      replays: dashboard.replays,
      exitAccuracy: dashboard.stats.exitAccuracy,
      profitProtection: protections,
      recommendations: dashboard.recommendations.slice(0, 20),
      timeline: dashboard.analyses.slice(0, 30),
      patterns,
      architecture: { partialExit: PARTIAL_EXIT_ARCH, trailing: TRAILING_ARCH },
      stats: dashboard.stats,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
