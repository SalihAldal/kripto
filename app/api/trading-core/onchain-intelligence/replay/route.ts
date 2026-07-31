import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { replayOnChainEvent, replayRecentEvents } from "@/src/server/onchain-intelligence/onchain-replay.service";
import { learnFromOnChainMetrics } from "@/src/server/onchain-intelligence/onchain-learning.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const eventId = request.nextUrl.searchParams.get("eventId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);

    if (eventId) {
      const replay = await replayOnChainEvent(eventId);
      return apiOkFromRequest(request, { eventId, replay });
    }

    const [replays, learning] = await Promise.all([
      prisma.onChainReplay.findMany({ orderBy: { replayedAt: "desc" }, take: limit }),
      learnFromOnChainMetrics(200),
    ]);
    return apiOkFromRequest(request, { replays, learning, count: replays.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 15);
    const result = await replayRecentEvents(limit);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
