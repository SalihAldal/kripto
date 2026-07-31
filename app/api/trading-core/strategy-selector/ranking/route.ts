import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { generateStrategyBenchmark } from "@/src/server/strategy-selector/strategy-benchmark.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const benchmark = await prisma.adaptiveStrategyBenchmark.findFirst({ orderBy: { generatedAt: "desc" } });
    const selections = await prisma.adaptiveStrategySelection.findMany({ orderBy: { selectedAt: "desc" }, take: 20, select: { primaryStrategy: true, strategyConfidence: true, rankings: true } });
    return apiOkFromRequest(request, { benchmark, recentRankings: selections.map((s) => s.rankings) });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { symbol?: string };
    const result = await generateStrategyBenchmark(body.symbol ?? "BTCUSDT");
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
