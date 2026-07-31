import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getGovernanceDashboard } from "@/src/server/ai-governance/ai-governance.repository";
import { getAiGovernanceWorkerState } from "@/src/server/ai-governance/ai-governance-workers";
import { aiGovernanceQueue } from "@/src/server/ai-governance/ai-governance-queue";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [dashboard, workerState, jobStates, queueStats] = await Promise.all([
      getGovernanceDashboard(),
      Promise.resolve(getAiGovernanceWorkerState()),
      prisma.aiGovernanceJobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(aiGovernanceQueue.stats()),
    ]);
    return apiOkFromRequest(request, { dashboard, workerState, jobStates, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
