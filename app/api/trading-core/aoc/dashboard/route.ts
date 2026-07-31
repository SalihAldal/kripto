import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getAocDashboard } from "@/src/server/aoc/aoc.repository";
import { getLatestHealthScores } from "@/src/server/aoc/aoc.repository";
import { getServiceGraph } from "@/src/server/aoc/dependency-map.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, scores, serviceGraph] = await Promise.all([
      getAocDashboard(),
      getLatestHealthScores(),
      Promise.resolve(getServiceGraph()),
    ]);
    return apiOkFromRequest(request, {
      platformOverview: dashboard.platform[0] ?? null,
      tradingOverview: dashboard.trading[0] ?? null,
      exchangeStatus: dashboard.exchange[0] ?? null,
      aiStatus: dashboard.aiHealth[0] ?? null,
      infrastructure: dashboard.infrastructure[0] ?? null,
      queues: dashboard.anomalies,
      incidents: dashboard.incidents,
      recovery: dashboard.recoveries,
      scores,
      serviceGraph,
      kpis: dashboard.kpis[0] ?? null,
      timelines: dashboard.timelines,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
