import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getNewsDashboard } from "@/src/server/news-intelligence/news-intelligence.repository";
import { getNewsIntelligenceWorkerState } from "@/src/server/news-intelligence/news-intelligence-workers";
import { newsIntelligenceQueue } from "@/src/server/news-intelligence/news-intelligence-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getNewsDashboard(),
      Promise.resolve(getNewsIntelligenceWorkerState()),
      prisma.newsIntelligenceJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(newsIntelligenceQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
