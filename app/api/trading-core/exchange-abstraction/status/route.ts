import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getExchangeDashboard } from "@/src/server/exchange-abstraction/exchange-abstraction.repository";
import { getExchangeAbstractionWorkerState } from "@/src/server/exchange-abstraction/exchange-abstraction-workers";
import { exchangeAbstractionQueue } from "@/src/server/exchange-abstraction/exchange-abstraction-queue";
import { getConnectionStatus } from "@/src/server/exchange-abstraction/connection-manager.service";
import { getRateLimitStatus } from "@/src/server/exchange-abstraction/rate-limit-manager.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats, connections, rateLimits] = await Promise.all([
      getExchangeDashboard(),
      Promise.resolve(getExchangeAbstractionWorkerState()),
      prisma.exchangeAbstractionJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(exchangeAbstractionQueue.stats()),
      Promise.resolve(getConnectionStatus()),
      Promise.resolve(getRateLimitStatus("BINANCE_SPOT")),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats, connections, rateLimits });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
