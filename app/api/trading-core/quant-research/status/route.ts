import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getResearchDashboard } from "@/src/server/quant-research/quant-research.repository";
import { getQuantResearchWorkerState } from "@/src/server/quant-research/quant-research-workers";
import { quantResearchQueue } from "@/src/server/quant-research/quant-research-queue";
import { assertResearchIsolation } from "@/src/server/quant-research/research-environment.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats, sandbox] = await Promise.all([
      getResearchDashboard(),
      Promise.resolve(getQuantResearchWorkerState()),
      prisma.quantResearchJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(quantResearchQueue.stats()),
      Promise.resolve(assertResearchIsolation()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats, sandbox });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
