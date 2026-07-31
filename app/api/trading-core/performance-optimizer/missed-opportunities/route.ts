import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { analyzeMissedOpportunities } from "@/src/server/performance-optimizer/missed-opportunity-analyzer.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const missed = await prisma.perfOptMissedOpportunity.findMany({ orderBy: { missedProfitPct: "desc" }, take: 50 });
    return apiOkFromRequest(request, { missed });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { limit?: number };
    const result = await analyzeMissedOpportunities(body.limit ?? 20);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
