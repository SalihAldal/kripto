import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getExitDashboard } from "@/src/server/exit-timing/exit-timing.repository";
import { getExitTimingWorkerState } from "@/src/server/exit-timing/exit-timing-workers";
import { exitTimingQueue } from "@/src/server/exit-timing/exit-timing-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getExitDashboard(),
      Promise.resolve(getExitTimingWorkerState()),
      prisma.exitTimingJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(exitTimingQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
