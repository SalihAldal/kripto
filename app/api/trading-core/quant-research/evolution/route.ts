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
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const [evolutions, candidates] = await Promise.all([
      prisma.strategyEvolution.findMany({ orderBy: { createdAt: "desc" }, take: Number.isFinite(limit) ? limit : 50, include: { genome: true } }),
      prisma.strategyCandidate.findMany({ orderBy: { score: "desc" }, take: Number.isFinite(limit) ? limit : 30, include: { genome: true } }),
    ]);
    return apiOkFromRequest(request, { evolutions, candidates });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
