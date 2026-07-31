import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getStrategySelectorDashboard, getLatestRegime, getLatestSelection } from "@/src/server/strategy-selector/strategy-selector.repository";
import { getStrategySelectorWorkerState } from "@/src/server/strategy-selector/strategy-selector-workers";
import { strategySelectorQueue } from "@/src/server/strategy-selector/strategy-selector-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const [dashboard, workerState, jobStates, queueStats, latestRegime, latestSelection] = await Promise.all([
      getStrategySelectorDashboard(),
      Promise.resolve(getStrategySelectorWorkerState()),
      prisma.strategySelectorJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(strategySelectorQueue.stats()),
      getLatestRegime(symbol),
      getLatestSelection(symbol),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats, latestRegime, latestSelection });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
