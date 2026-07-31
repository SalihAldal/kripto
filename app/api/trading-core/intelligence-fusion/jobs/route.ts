import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueIntelligenceFusionJob } from "@/src/server/intelligence-fusion/intelligence-fusion-queue";
import type { IntelligenceFusionJobPayload } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.intelligenceFusionJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, jobStates);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as IntelligenceFusionJobPayload;
    if (!body?.type) return apiErrorFromUnknown(new Error("Missing job type"));
    const job = await enqueueIntelligenceFusionJob(body);
    return apiOkFromRequest(request, job);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
