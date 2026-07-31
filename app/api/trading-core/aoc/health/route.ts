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
    const [platform, trading, infrastructure, exchange, aiHealth] = await Promise.all([
      prisma.platformHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
      prisma.tradingHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
      prisma.infrastructureHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
      prisma.exchangeHealthHistory.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
      prisma.aocAiHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
    ]);
    return apiOkFromRequest(request, { platform, trading, infrastructure, exchange, aiHealth });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
