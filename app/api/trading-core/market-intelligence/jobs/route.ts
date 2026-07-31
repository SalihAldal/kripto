import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueMarketIntelJob, marketIntelQueue } from "@/src/server/market-intelligence/market-intelligence-queue";
import { ensureMarketIntelWorkersStarted, getMarketIntelWorkerState } from "@/src/server/market-intelligence/market-intelligence-workers";
import type { MarketIntelJobPayload } from "@/src/server/market-intelligence/market-intelligence.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const states = await prisma.marketIntelJobState.findMany({ orderBy: { updatedAt: "desc" } });
    return apiOkFromRequest(request, { workers: getMarketIntelWorkerState(), queue: marketIntelQueue.stats(), states });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as MarketIntelJobPayload & { startWorkers?: boolean };
    if (body.startWorkers) ensureMarketIntelWorkersStarted();
    if (!body.type) return apiErrorFromUnknown(new Error("type required"));
    const job = await enqueueMarketIntelJob(body);
    return apiOkFromRequest(request, { queued: true, job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
