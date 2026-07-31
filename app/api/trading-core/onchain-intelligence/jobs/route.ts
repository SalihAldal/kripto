import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueOnChainIntelligenceJob } from "@/src/server/onchain-intelligence/onchain-intelligence-queue";
import type { OnChainIntelligenceJobPayload } from "@/src/server/onchain-intelligence/onchain-intelligence.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.onChainIntelligenceJobState.findMany({ orderBy: { updatedAt: "desc" } });
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
    const body = (await request.json()) as OnChainIntelligenceJobPayload;
    if (!body?.type) {
      return apiErrorFromUnknown(new Error("Missing job type"));
    }
    const job = await enqueueOnChainIntelligenceJob(body);
    return apiOkFromRequest(request, job);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
