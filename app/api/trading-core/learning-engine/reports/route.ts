import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { listResearchLabIdeas } from "@/src/server/learning-engine/research-lab.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const type = request.nextUrl.searchParams.get("type") ?? "weekly";
    if (type === "research-lab") {
      const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
      return apiOkFromRequest(request, listResearchLabIdeas(Number.isFinite(limit) ? limit : 20));
    }
    const weekStartParam = request.nextUrl.searchParams.get("weekStart");
    if (weekStartParam) {
      const weekStart = new Date(weekStartParam);
      const report = await prisma.weeklyResearch.findUnique({ where: { weekStart } });
      return apiOkFromRequest(request, report);
    }
    const reports = await prisma.weeklyResearch.findMany({ orderBy: { weekStart: "desc" }, take: 12 });
    return apiOkFromRequest(request, reports);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
