import { NextRequest } from "next/server";
import { apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { RANKING_LOGIC_POLICY } from "@/src/server/scanner/candidate-ranking.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;

    return apiOkFromRequest(request, {
      gatePolicy: RANKING_LOGIC_POLICY,
      configuration: {
        scannerTopCandidates: env.SCANNER_TOP_CANDIDATES,
        discoveryV2IntegrateScanner: env.DISCOVERY_V2_INTEGRATE_SCANNER,
        tradingCoreS2Enabled: env.TRADING_CORE_S2_ENABLED,
      },
      workflow: [
        "scoreContext per symbol",
        "rankCandidates (scanner primary)",
        "Optional discovery-v2 boost",
        "AI consensus on top-N",
      ],
      deploymentChecks: [
        "GET /api/trading-core/discovery/rankings responds",
        "GET /api/scanner/ranking/policy returns snapshot",
        "npm run test:run -- tests/scanner.test.ts",
      ],
    });
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
