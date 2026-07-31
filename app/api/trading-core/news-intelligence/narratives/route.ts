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
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const narratives = await prisma.narrative.findMany({
      orderBy: { heatScore: "desc" },
      take: limit,
      include: { history: { orderBy: { recordedAt: "desc" }, take: 10 } },
    });
    return apiOkFromRequest(request, { narratives, count: narratives.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
