import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { replayDecision } from "@/src/server/replay/decision-replay.engine";
import { getReplayByDecisionId } from "@/src/server/replay/replay-dashboard.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const decisionId = request.nextUrl.searchParams.get("decisionId");
    if (decisionId) {
      return apiOkFromRequest(request, await getReplayByDecisionId(decisionId));
    }

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const rows = await prisma.decisionReplay.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(200, limit)),
      include: {
        evaluation: true,
        missedOpportunity: true,
      },
    });
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;

    const body = (await request.json()) as { decisionId?: string };
    if (!body.decisionId) {
      return apiErrorFromUnknown(new Error("decisionId required"));
    }
    const result = await replayDecision({ decisionId: body.decisionId, cadence: "MANUAL" });
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
