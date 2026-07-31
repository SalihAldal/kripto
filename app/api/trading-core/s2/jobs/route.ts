import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { enqueueTradingCoreS2Job, tradingCoreS2Queue } from "@/src/server/trading-core-s2/trading-core-s2.queue";
import { getTradingCoreS2WorkerState } from "@/src/server/trading-core-s2/trading-core-s2.workers";
import type { TradingCoreS2JobPayload } from "@/src/server/trading-core-s2/trading-core-s2.types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [jobStates, workerState, queueStats] = await Promise.all([
      prisma.tradingCoreS2JobState.findMany({ orderBy: { updatedAt: "desc" } }),
      Promise.resolve(getTradingCoreS2WorkerState()),
      Promise.resolve(tradingCoreS2Queue.stats()),
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
    const body = (await request.json()) as TradingCoreS2JobPayload;
    if (!body?.type) return apiErrorFromUnknown(new Error("Invalid job payload"));
    const job = await enqueueTradingCoreS2Job(body);
    return apiOkFromRequest(request, { job });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
