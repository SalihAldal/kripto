import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getStrategySelectorDashboard } from "@/src/server/strategy-selector/strategy-selector.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const dashboard = await getStrategySelectorDashboard();
    return apiOkFromRequest(request, {
      currentRegime: dashboard.regimes[0] ?? null,
      currentSelection: dashboard.selections[0] ?? null,
      alternativeStrategies: dashboard.selections[0]?.secondaryStrategy ? [dashboard.selections[0].secondaryStrategy] : [],
      rankings: dashboard.selections[0]?.rankings ?? [],
      performance: dashboard.performances,
      marketCompatibility: dashboard.knowledge,
      benchmark: dashboard.benchmarks,
      pendingSwitches: dashboard.switches,
      stats: dashboard.stats,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
