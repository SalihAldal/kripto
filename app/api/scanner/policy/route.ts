import { NextRequest } from "next/server";
import { apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { SIGNAL_GENERATION_POLICY } from "@/src/server/scanner/signal-scoring.engine";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;

    return apiOkFromRequest(request, {
      gatePolicy: SIGNAL_GENERATION_POLICY,
      configuration: {
        scannerMinScore: env.SCANNER_MIN_SCORE,
        scannerMinVolume24h: env.SCANNER_MIN_VOLUME_24H,
        scannerMaxSpreadPercent: env.SCANNER_MAX_SPREAD_PERCENT,
        scannerTopCandidates: env.SCANNER_TOP_CANDIDATES,
        scannerWorkerEnabled: env.SCANNER_WORKER_ENABLED,
      },
      workflow: [
        "Build market context",
        "scoreContext",
        "rankCandidates",
        "AI consensus (optional)",
        "signal-quality-gate",
        "persist + execution",
      ],
      deploymentChecks: [
        "GET /api/market/scan returns snapshot",
        "POST /api/scanner/run responds with token",
        "GET /api/scanner/policy returns policy snapshot",
        "npm run test:run -- tests/scanner.test.ts",
      ],
    });
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
