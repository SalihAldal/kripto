import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  listExecutionLogs,
  listOpenPositions,
  listRecentExecutionLogsBySymbol,
} from "@/src/server/execution-engine-v2/execution-engine-v2.repository";
import { getExecutionEngineV2WorkerState } from "@/src/server/execution-engine-v2/execution-engine-v2.workers";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
    const executionId = request.nextUrl.searchParams.get("executionId");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);

    if (executionId) {
      const logs = await prisma.executionLog.findMany({
        where: { executionId },
        orderBy: { submittedAt: "desc" },
      });
      return apiOkFromRequest(request, { logs, worker: getExecutionEngineV2WorkerState() });
    }

    const logs = symbol
      ? await listRecentExecutionLogsBySymbol(symbol, limit)
      : await listExecutionLogs(limit);
    const openPositionsRaw = await listOpenPositions(20);
    const openPositions = openPositionsRaw.map((p) => ({
      id: p.id,
      symbol: p.tradingPair.symbol,
      quantity: p.quantity,
      status: p.status,
    }));
    return apiOkFromRequest(request, { logs, openPositions, worker: getExecutionEngineV2WorkerState() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
