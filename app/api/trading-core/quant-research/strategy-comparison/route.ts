import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getStrategyComparison, getStrategyLeaderboard, runStrategyBenchmark } from "@/src/server/quant-research/strategy-benchmark.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const view = request.nextUrl.searchParams.get("view");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    if (view === "leaderboard") {
      return apiOkFromRequest(request, await getStrategyLeaderboard());
    }
    return apiOkFromRequest(request, await getStrategyComparison(limit));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { experimentId?: string; windowDays?: number; limit?: number };
    return apiOkFromRequest(request, await runStrategyBenchmark(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
