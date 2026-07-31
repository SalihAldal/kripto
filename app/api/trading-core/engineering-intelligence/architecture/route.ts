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
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const findings = await prisma.architectureAudit.findMany({
      where: { recordedAt: { gte: since } },
      orderBy: { recordedAt: "desc" },
      take: limit,
    });
    return apiOkFromRequest(request, { findings, count: findings.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
