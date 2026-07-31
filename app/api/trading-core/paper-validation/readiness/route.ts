import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { calculateAllReadinessScores, calculateLiveReadiness } from "@/src/server/paper-validation/live-readiness.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId");
    if (userId) {
      return apiOkFromRequest(request, await calculateLiveReadiness(userId));
    }
    const rows = await prisma.liveReadiness.findMany({ orderBy: { reportDate: "desc" }, take: 20 });
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { userId?: string };
    if (body.userId) {
      return apiOkFromRequest(request, await calculateLiveReadiness(body.userId));
    }
    return apiOkFromRequest(request, await calculateAllReadinessScores());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
