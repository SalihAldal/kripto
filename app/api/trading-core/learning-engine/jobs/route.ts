import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueLearningEngineJob } from "@/src/server/learning-engine/learning-engine-queue";
import type { LearningEngineJobPayload } from "@/src/server/learning-engine/learning-engine.types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const { prisma } = await import("@/src/server/db/prisma");
    const jobStates = await prisma.learningEngineJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, jobStates);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as LearningEngineJobPayload;
    if (!body?.type) {
      return apiErrorFromUnknown(new Error("Missing job type"));
    }
    const job = await enqueueLearningEngineJob(body);
    return apiOkFromRequest(request, job);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
