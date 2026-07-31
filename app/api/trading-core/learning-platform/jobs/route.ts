import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  enqueueLearningPlatformJob,
  learningPlatformQueue,
} from "@/src/server/learning-platform/learning-platform.queue";
import type { LearningPlatformJobPayload } from "@/src/server/learning-platform/learning-platform.types";
import { getLearningPlatformWorkerState } from "@/src/server/learning-platform/learning-platform.workers";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.learningPlatformJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, {
      jobStates,
      queueStats: learningPlatformQueue.stats(),
      worker: getLearningPlatformWorkerState(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as LearningPlatformJobPayload;
    const job = await enqueueLearningPlatformJob(body);
    return apiOkFromRequest(request, { job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
