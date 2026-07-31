import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getPerfOptDashboard } from "@/src/server/performance-optimizer/performance-optimizer.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const dashboard = await getPerfOptDashboard();
    return apiOkFromRequest(request, {
      dailyReview: dashboard.reviews[0] ?? null,
      tradeQuality: dashboard.qualities,
      missedOpportunities: dashboard.missed,
      bestTrades: dashboard.bestTrades,
      worstTrades: dashboard.worstTrades,
      strategyRanking: dashboard.strategyRanks,
      coinRanking: dashboard.coinRanks,
      recommendations: dashboard.recommendations,
      timeline: dashboard.timeline,
      successMetrics: dashboard.successMetrics,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
