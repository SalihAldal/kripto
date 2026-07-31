import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listPatternExplorer } from "@/src/server/learning-engine/learning-engine.repository";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    const status = request.nextUrl.searchParams.get("status");
    const patterns = status
      ? await prisma.patternLibrary.findMany({
          where: { status: status as "WINNING" | "LOSING" | "NEUTRAL" },
          orderBy: { expectancy: "desc" },
          take: Number.isFinite(limit) ? limit : 100,
        })
      : await listPatternExplorer(Number.isFinite(limit) ? limit : 100);
    const performance = await prisma.patternPerformance.findMany({
      orderBy: { recordedAt: "desc" },
      take: Number.isFinite(limit) ? limit : 50,
    });
    return apiOkFromRequest(request, { patterns, performance });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
