import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { replayNewsImpact } from "@/src/server/news-intelligence/news-replay.service";
import { learnFromNewsHistory } from "@/src/server/news-intelligence/news-learning.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const articleId = request.nextUrl.searchParams.get("articleId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);

    if (articleId) {
      const [replay, timeline] = await Promise.all([
        replayNewsImpact(articleId),
        prisma.newsReplay.findMany({ where: { articleId }, orderBy: { replayedAt: "desc" } }),
      ]);
      return apiOkFromRequest(request, { articleId, replay, timeline });
    }

    const [replays, learning] = await Promise.all([
      prisma.newsReplay.findMany({
        orderBy: { replayedAt: "desc" },
        take: limit,
        include: { article: { include: { classification: true, impact: true, source: true } } },
      }),
      learnFromNewsHistory(200),
    ]);
    return apiOkFromRequest(request, { replays, learning, count: replays.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
