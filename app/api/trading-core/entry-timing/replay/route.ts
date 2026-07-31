import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { replayRecentBuys, replayEntry } from "@/src/server/entry-timing/entry-replay.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const replays = await prisma.entryReplay.findMany({ orderBy: { replayedAt: "desc" }, take: limit, include: { analysis: true } });
    return apiOkFromRequest(request, { replays });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { symbol?: string; entryPrice?: number; entryAt?: string; analysisId?: string; limit?: number };
    if (body.symbol && body.entryPrice && body.entryAt) {
      const replay = await replayEntry({
        symbol: body.symbol.toUpperCase(),
        entryPrice: body.entryPrice,
        entryAt: new Date(body.entryAt),
        analysisId: body.analysisId,
      });
      return apiOkFromRequest(request, { replay });
    }
    const result = await replayRecentBuys(body.limit ?? 10);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
