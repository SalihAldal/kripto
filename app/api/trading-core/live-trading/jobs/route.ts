import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { enqueueLiveTradingJob, getLiveTradingQueueStats } from "@/src/server/live-trading/live-trading.queue";
import type { LiveTradingJobPayload } from "@/src/server/live-trading/live-trading.types";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const jobStates = await prisma.liveTradingJobState.findMany({ orderBy: { updatedAt: "desc" } });
    const queue = getLiveTradingQueueStats();
    return apiOkFromRequest(request, { jobStates, queue });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as LiveTradingJobPayload;
    if (!body?.type) return apiErrorFromUnknown(new Error("Missing job type"));
    const job = await enqueueLiveTradingJob(body);
    return apiOkFromRequest(request, job);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
