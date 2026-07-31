import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listStrategyExplorer } from "@/src/server/quant-research/quant-research.repository";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const archetype = request.nextUrl.searchParams.get("archetype");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    const strategies = archetype
      ? await prisma.strategyGenome.findMany({
          where: { archetype: archetype as never },
          orderBy: { updatedAt: "desc" },
          take: Number.isFinite(limit) ? limit : 100,
          include: { candidates: { orderBy: { score: "desc" }, take: 3 } },
        })
      : await listStrategyExplorer(Number.isFinite(limit) ? limit : 100);
    return apiOkFromRequest(request, strategies);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
