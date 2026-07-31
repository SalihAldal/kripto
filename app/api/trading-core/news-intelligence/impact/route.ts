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
    const rankings = await prisma.newsImpact.findMany({
      orderBy: { impactScore: "desc" },
      take: limit,
      include: { article: { include: { source: true, classification: true } } },
    });
    return apiOkFromRequest(request, { rankings, count: rankings.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
