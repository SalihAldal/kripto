import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  getLatestDiscoverySnapshot,
  listMomentumCandidates,
  getLatestMomentumStatistics,
  listRejectedDiscoveryScores,
} from "@/src/server/trading-core-s2/trading-core-s2.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const discovery = await getLatestDiscoverySnapshot();
    const [momentum, stats, rejected] = await Promise.all([
      listMomentumCandidates(30),
      getLatestMomentumStatistics(),
      discovery ? listRejectedDiscoveryScores(discovery.id, 30) : Promise.resolve([]),
    ]);
    return apiOkFromRequest(request, {
      topOpportunities: discovery?.candidates ?? [],
      rankings: discovery?.rankings ?? [],
      report: discovery?.report ?? null,
      momentumCandidates: momentum,
      rejectedCandidates: rejected,
      statistics: stats,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
