import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getEntryDashboard } from "@/src/server/entry-timing/entry-timing.repository";
import { generateEntryHeatmap } from "@/src/server/entry-timing/entry-heatmap.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, heatmap] = await Promise.all([
      getEntryDashboard(),
      generateEntryHeatmap(),
    ]);
    return apiOkFromRequest(request, {
      bestEntries: dashboard.bestEntries,
      worstEntries: dashboard.worstEntries,
      replays: dashboard.replays,
      heatmap: heatmap.heatmap,
      entryAccuracy: dashboard.stats.entryAccuracy,
      bestPatterns: dashboard.bestPatterns,
      worstPatterns: dashboard.worstPatterns,
      recentRecommendations: dashboard.recommendations.slice(0, 20),
      stats: dashboard.stats,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
