import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { replayWhaleEvent } from "@/src/server/whale-intelligence/whale-replay.service";
import { learnFromWhaleHistory } from "@/src/server/whale-intelligence/institutional-learning.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const transactionId = request.nextUrl.searchParams.get("transactionId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);

    if (transactionId) {
      const [replay, timeline] = await Promise.all([
        replayWhaleEvent(transactionId),
        prisma.whaleReplay.findMany({ where: { transactionId }, orderBy: { replayedAt: "desc" } }),
      ]);
      return apiOkFromRequest(request, { transactionId, replay, timeline });
    }

    const [replays, learning] = await Promise.all([
      prisma.whaleReplay.findMany({
        orderBy: { replayedAt: "desc" },
        take: limit,
        include: { transaction: { include: { wallet: true } } },
      }),
      learnFromWhaleHistory(200),
    ]);
    return apiOkFromRequest(request, { replays, learning, count: replays.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
