import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getPerfOptDashboard } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { getPerfOptWorkerState } from "@/src/server/performance-optimizer/performance-optimizer-workers";
import { perfOptQueue } from "@/src/server/performance-optimizer/performance-optimizer-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats, successMetrics] = await Promise.all([
      getPerfOptDashboard(),
      Promise.resolve(getPerfOptWorkerState()),
      prisma.perfOptJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(perfOptQueue.stats()),
      prisma.perfOptSuccessMetrics.findFirst({ orderBy: { calculatedAt: "desc" } }),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats, successMetrics });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
