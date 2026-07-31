import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { buildPlatformTimeline, buildTradeTimeline, buildDecisionTimeline, buildExecutionTimeline, buildLearningTimeline } from "@/src/server/event-platform/event-timeline.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const type = request.nextUrl.searchParams.get("type") ?? "platform";
    const id = request.nextUrl.searchParams.get("id");

    if (type === "platform") return apiOkFromRequest(request, await buildPlatformTimeline());
    if (type === "trade" && id) return apiOkFromRequest(request, await buildTradeTimeline(id));
    if (type === "decision" && id) return apiOkFromRequest(request, await buildDecisionTimeline(id));
    if (type === "execution" && id) return apiOkFromRequest(request, await buildExecutionTimeline(id));
    if (type === "learning" && id) return apiOkFromRequest(request, await buildLearningTimeline(id));

    const timelines = await prisma.eventTimeline.findMany({ orderBy: { generatedAt: "desc" }, take: 20 });
    return apiOkFromRequest(request, timelines);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
