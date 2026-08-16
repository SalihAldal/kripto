import { NextRequest } from "next/server";
import { apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { FEATURE_PIPELINE_POLICY } from "@/src/server/quant-research/feature-research.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;

    return apiOkFromRequest(request, {
      gatePolicy: FEATURE_PIPELINE_POLICY,
      configuration: {
        marketAnalysisServiceUrl: process.env.MARKET_ANALYSIS_SERVICE_URL ?? "http://127.0.0.1:8010",
        marketAnalysisTimeoutMs: Number(process.env.MARKET_ANALYSIS_TIMEOUT_MS ?? 1200),
      },
      workflow: [
        "Python runtime feature engineering (market-analysis-service)",
        "Quant research DB feature importance",
        "Learning engine feature registry",
        "Strategy/scanner consumption",
      ],
      deploymentChecks: [
        "Python market-analysis-service reachable",
        "GET /api/trading-core/quant-research/feature-ranking responds",
        "GET /api/trading-core/quant-research/feature-pipeline/policy returns snapshot",
      ],
    });
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
