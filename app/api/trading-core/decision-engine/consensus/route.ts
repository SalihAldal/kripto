import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getConsensusDecision } from "@/src/server/decision-engine/decision-engine.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const decisionId = request.nextUrl.searchParams.get("decisionId");
    if (decisionId) {
      const row = await getConsensusDecision(decisionId);
      return apiOkFromRequest(request, { row });
    }
    const symbol = request.nextUrl.searchParams.get("symbol");
    if (symbol) {
      const { getLatestConsensusBySymbol } = await import("@/src/server/decision-engine/decision-engine.repository");
      const row = await getLatestConsensusBySymbol(symbol);
      return apiOkFromRequest(request, { row });
    }
    return apiOkFromRequest(request, { error: "decisionId or symbol required" });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
