import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueExitTimingJob, exitTimingQueue } from "@/src/server/exit-timing/exit-timing-queue";
import type { ExitTimingJobPayload } from "@/src/server/exit-timing/exit-timing.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.exitTimingJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, { jobStates, queueStats: exitTimingQueue.stats() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as ExitTimingJobPayload;
    const job = await enqueueExitTimingJob(body);
    return apiOkFromRequest(request, { job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
