import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLearningDashboard } from "@/src/server/learning-engine/learning-engine.repository";
import { getLearningEngineWorkerState } from "@/src/server/learning-engine/learning-engine-workers";
import { learningEngineQueue } from "@/src/server/learning-engine/learning-engine-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getLearningDashboard(),
      Promise.resolve(getLearningEngineWorkerState()),
      prisma.learningEngineJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(learningEngineQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
