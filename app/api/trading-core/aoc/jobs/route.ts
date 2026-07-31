import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueAocJob, aocQueue } from "@/src/server/aoc/aoc-queue";
import { runAocFullCycle } from "@/src/server/aoc/aoc.orchestrator";
import type { AocJobPayload } from "@/src/server/aoc/aoc.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.aocJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, { jobStates, queueStats: aocQueue.stats() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { type?: AocJobPayload["type"]; fullCycle?: boolean };
    if (body.fullCycle) {
      const result = await runAocFullCycle();
      return apiOkFromRequest(request, { result });
    }
    if (body.type) {
      const job = await enqueueAocJob({ type: body.type });
      return apiOkFromRequest(request, { job });
    }
    return apiErrorFromUnknown(new Error("Specify type or fullCycle"));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
