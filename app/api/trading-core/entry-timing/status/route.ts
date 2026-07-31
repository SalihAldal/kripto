import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getEntryDashboard } from "@/src/server/entry-timing/entry-timing.repository";
import { getEntryTimingWorkerState } from "@/src/server/entry-timing/entry-timing-workers";
import { entryTimingQueue } from "@/src/server/entry-timing/entry-timing-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getEntryDashboard(),
      Promise.resolve(getEntryTimingWorkerState()),
      prisma.entryTimingJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(entryTimingQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
