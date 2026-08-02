import { NextRequest } from "next/server";
import { apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { AI_CONSENSUS_POLICY } from "@/src/server/ai/consensus-engine";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;

    return apiOkFromRequest(request, {
      policy: AI_CONSENSUS_POLICY,
      configuration: {
        aiMinConfidence: env.AI_MIN_CONFIDENCE,
        aiMaxRiskScore: env.AI_MAX_RISK_SCORE,
        aiStrictAnalystMode: env.AI_STRICT_ANALYST_MODE,
        aiMinHealthyProviderCount: env.AI_MIN_HEALTHY_PROVIDER_COUNT,
        aiRequireUnanimousBuySell: env.AI_REQUIRE_UNANIMOUS_BUY_SELL,
        aiQualityProfile: env.AI_QUALITY_PROFILE,
      },
      workflow: [
        "Collect provider outputs",
        "rejectUnsafeTrade majority risk veto",
        "summarizeConsensus directional + confidence gates",
        "Return finalDecision to execution pipeline",
      ],
      deploymentChecks: [
        "POST /api/ai/consensus responds with token",
        "GET /api/ai/consensus/policy returns policy snapshot",
        "npm run test:run -- tests/consensus-engine.test.ts",
      ],
    });
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
