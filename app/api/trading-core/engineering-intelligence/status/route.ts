import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getEngineeringDashboard } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { getEngineeringIntelligenceWorkerState } from "@/src/server/engineering-intelligence/engineering-intelligence-workers";
import { engineeringIntelligenceQueue } from "@/src/server/engineering-intelligence/engineering-intelligence-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getEngineeringDashboard(),
      Promise.resolve(getEngineeringIntelligenceWorkerState()),
      prisma.engineeringIntelligenceJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(engineeringIntelligenceQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
