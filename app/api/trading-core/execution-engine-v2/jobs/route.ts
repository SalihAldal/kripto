import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  enqueueExecutionEngineV2Job,
  executionEngineV2Queue,
} from "@/src/server/execution-engine-v2/execution-engine-v2.queue";
import type { ExecutionEngineV2JobPayload } from "@/src/server/execution-engine-v2/execution-engine-v2.types";
import { prisma } from "@/src/server/db/prisma";
import { getExecutionEngineV2WorkerState } from "@/src/server/execution-engine-v2/execution-engine-v2.workers";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.executionEngineV2JobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, {
      jobStates,
      queueStats: executionEngineV2Queue.stats(),
      worker: getExecutionEngineV2WorkerState(),
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
    const body = (await request.json()) as ExecutionEngineV2JobPayload;
    const job = await enqueueExecutionEngineV2Job(body);
    return apiOkFromRequest(request, { job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
