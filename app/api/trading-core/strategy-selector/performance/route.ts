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
    const [performances, knowledge] = await Promise.all([
      prisma.adaptiveStrategyPerformance.findMany({ orderBy: { recordedAt: "desc" }, take: 50 }),
      prisma.adaptiveStrategyKnowledge.findMany({ orderBy: { updatedAt: "desc" }, take: 30 }),
    ]);
    return apiOkFromRequest(request, { performances, knowledge });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
