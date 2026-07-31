import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { getRotationSummary } from "@/src/server/whale-intelligence/liquidity-movement.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const [institutional, rotations, scores] = await Promise.all([
      prisma.institutionalFlow.findMany({ orderBy: { detectedAt: "desc" }, take: limit }),
      getRotationSummary(),
      prisma.whaleScore.findMany({ orderBy: { whaleActivityScore: "desc" }, take: limit, include: { wallet: true } }),
    ]);
    return apiOkFromRequest(request, { institutional, rotations, scores });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
