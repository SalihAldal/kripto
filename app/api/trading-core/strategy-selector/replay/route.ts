import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { replayRecentSelections, replayStrategySelection } from "@/src/server/strategy-selector/strategy-replay.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const replays = await prisma.adaptiveStrategyReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 30, include: { selection: true } });
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
    const body = await request.json() as { selectionId?: string; limit?: number };
    if (body.selectionId) {
      const replay = await replayStrategySelection(body.selectionId);
      return apiOkFromRequest(request, { replay });
    }
    const result = await replayRecentSelections(body.limit ?? 10);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
