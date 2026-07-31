import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { replayRecentExits, replayExit } from "@/src/server/exit-timing/exit-replay.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const replays = await prisma.exitReplay.findMany({
      orderBy: { replayedAt: "desc" },
      take: Number(request.nextUrl.searchParams.get("limit") ?? 20),
      include: { analysis: true },
    });
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
    const body = await request.json() as {
      symbol?: string; exitPrice?: number; exitAt?: string; entryPrice?: number; analysisId?: string; limit?: number;
    };
    if (body.symbol && body.exitPrice && body.exitAt && body.entryPrice) {
      const replay = await replayExit({
        symbol: body.symbol.toUpperCase(),
        exitPrice: body.exitPrice,
        exitAt: new Date(body.exitAt),
        entryPrice: body.entryPrice,
        analysisId: body.analysisId,
      });
      return apiOkFromRequest(request, { replay });
    }
    const result = await replayRecentExits(body.limit ?? 10);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
