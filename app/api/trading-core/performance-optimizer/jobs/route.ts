import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueuePerfOptJob, perfOptQueue } from "@/src/server/performance-optimizer/performance-optimizer-queue";
import { runFullOptimizationCycle } from "@/src/server/performance-optimizer/performance-optimizer.orchestrator";
import type { PerfOptJobPayload } from "@/src/server/performance-optimizer/performance-optimizer.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.perfOptJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, { jobStates, queueStats: perfOptQueue.stats() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as PerfOptJobPayload & { fullCycle?: boolean };
    if (body.fullCycle) {
      const result = await runFullOptimizationCycle();
      return apiOkFromRequest(request, { result });
    }
    const { fullCycle: _, ...payload } = body;
    const job = await enqueuePerfOptJob(payload as PerfOptJobPayload);
    return apiOkFromRequest(request, { job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
