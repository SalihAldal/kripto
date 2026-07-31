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
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const recommendations = await prisma.entryRecommendation.findMany({
      where: symbol ? { symbol: symbol.toUpperCase() } : undefined,
      orderBy: { recommendedAt: "desc" },
      take: 30,
      include: { analysis: true },
    });
    return apiOkFromRequest(request, { recommendations });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
