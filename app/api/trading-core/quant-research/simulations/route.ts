import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const [simulations, walkForwards, monteCarlos] = await Promise.all([
      prisma.simulationRun.findMany({ orderBy: { createdAt: "desc" }, take: Number.isFinite(limit) ? limit : 30 }),
      prisma.walkForwardRun.findMany({ orderBy: { createdAt: "desc" }, take: Number.isFinite(limit) ? limit : 30 }),
      prisma.monteCarloRun.findMany({ orderBy: { createdAt: "desc" }, take: Number.isFinite(limit) ? limit : 30 }),
    ]);
    return apiOkFromRequest(request, { simulations, walkForwards, monteCarlos });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
