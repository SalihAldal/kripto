import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLatestHealth, monitorProductionHealth } from "@/src/server/live-trading/live-health.service";
import { getLiveTradingWorkerState } from "@/src/server/live-trading/live-trading.workers";
import { getLiveTradingQueueStats } from "@/src/server/live-trading/live-trading.queue";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user?.id ?? undefined;
    const refresh = request.nextUrl.searchParams.get("refresh") === "true";

    const health = refresh && userId ? await monitorProductionHealth(userId) : await getLatestHealth(userId);
    const worker = getLiveTradingWorkerState();
    const queue = getLiveTradingQueueStats();

    return apiOkFromRequest(request, { health, worker, queue });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
