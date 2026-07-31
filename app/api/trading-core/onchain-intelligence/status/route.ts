import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getOnChainDashboard } from "@/src/server/onchain-intelligence/onchain-intelligence.repository";
import { getOnChainIntelligenceWorkerState } from "@/src/server/onchain-intelligence/onchain-intelligence-workers";
import { onChainIntelligenceQueue } from "@/src/server/onchain-intelligence/onchain-intelligence-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getOnChainDashboard(),
      Promise.resolve(getOnChainIntelligenceWorkerState()),
      prisma.onChainIntelligenceJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(onChainIntelligenceQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
