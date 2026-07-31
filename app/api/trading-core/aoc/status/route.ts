import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getAocDashboard, getLatestHealthScores } from "@/src/server/aoc/aoc.repository";
import { getAocWorkerState } from "@/src/server/aoc/aoc-workers";
import { aocQueue } from "@/src/server/aoc/aoc-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats, latestScore] = await Promise.all([
      getAocDashboard(),
      Promise.resolve(getAocWorkerState()),
      prisma.aocJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(aocQueue.stats()),
      getLatestHealthScores(),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats, latestScore });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
