import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import {
  enqueueDecisionEngineV2Job,
  decisionEngineV2Queue,
} from "@/src/server/decision-engine-v2/decision-engine-v2.queue";
import { getDecisionEngineV2WorkerState } from "@/src/server/decision-engine-v2/decision-engine-v2.workers";
import type { DecisionEngineV2JobPayload } from "@/src/server/decision-engine-v2/decision-engine-v2.types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [jobStates, workerState, queueStats] = await Promise.all([
      prisma.decisionEngineV2JobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(getDecisionEngineV2WorkerState()),
      Promise.resolve(decisionEngineV2Queue.stats()),
    ]);
    return apiOkFromRequest(request, { jobStates, workerState, queueStats });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as DecisionEngineV2JobPayload;
    if (!body?.type) return apiErrorFromUnknown(new Error("Invalid job payload"));
    const job = await enqueueDecisionEngineV2Job(body);
    return apiOkFromRequest(request, { job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
