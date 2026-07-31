import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getWhaleDashboard } from "@/src/server/whale-intelligence/whale-intelligence.repository";
import { getWhaleIntelligenceWorkerState } from "@/src/server/whale-intelligence/whale-intelligence-workers";
import { whaleIntelligenceQueue } from "@/src/server/whale-intelligence/whale-intelligence-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getWhaleDashboard(),
      Promise.resolve(getWhaleIntelligenceWorkerState()),
      prisma.whaleIntelligenceJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(whaleIntelligenceQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
