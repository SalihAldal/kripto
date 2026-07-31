import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getEventPlatformDashboard } from "@/src/server/event-platform/event-platform.repository";
import { getEventPlatformWorkerState } from "@/src/server/event-platform/event-platform-workers";
import { eventPlatformQueue } from "@/src/server/event-platform/event-platform-queue";
import { getConsumerLag } from "@/src/server/event-platform/observability.service";
import { getCheckpointStatus } from "@/src/server/event-platform/checkpoint.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats, consumerLag, checkpoints] = await Promise.all([
      getEventPlatformDashboard(),
      Promise.resolve(getEventPlatformWorkerState()),
      prisma.eventPlatformJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(eventPlatformQueue.stats()),
      getConsumerLag(),
      getCheckpointStatus(),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats, consumerLag, checkpoints });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
