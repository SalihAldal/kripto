import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { predictDecisionEngineV2 } from "@/src/server/decision-engine-v2/prediction.service";

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as {
      symbol: string;
      decisionId?: string;
      featureSnapshot?: Record<string, unknown>;
      scannerScore?: number;
      momentumScore?: number;
      discoveryScore?: number;
      marketRegime?: string;
    };
    if (!body?.symbol) return apiErrorFromUnknown(new Error("symbol is required"));
    const prediction = await predictDecisionEngineV2({
      symbol: body.symbol,
      decisionId: body.decisionId,
      featureSnapshot: body.featureSnapshot as never,
      scannerScore: body.scannerScore,
      momentumScore: body.momentumScore,
      discoveryScore: body.discoveryScore,
      marketRegime: body.marketRegime,
      persist: true,
    });
    return apiOkFromRequest(request, prediction);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
