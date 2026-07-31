import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueAiGovernanceJob } from "@/src/server/ai-governance/ai-governance-queue";
import type { AiGovernanceJobPayload } from "@/src/server/ai-governance/ai-governance.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, await prisma.aiGovernanceJobState.findMany({ orderBy: { updatedAt: "desc" } }));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as AiGovernanceJobPayload;
    if (!body?.type) return apiErrorFromUnknown(new Error("Missing job type"));
    return apiOkFromRequest(request, await enqueueAiGovernanceJob(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
