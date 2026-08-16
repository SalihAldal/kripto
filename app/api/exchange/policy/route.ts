import { NextRequest } from "next/server";
import { apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { env } from "@/lib/config";
import { getRequestLocale } from "@/lib/request-locale";
import { EXCHANGE_ADAPTER_POLICY } from "@/src/server/exchange/adapter-factory";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;

    return apiOkFromRequest(request, {
      gatePolicy: EXCHANGE_ADAPTER_POLICY,
      adapterVenue: EXCHANGE_ADAPTER_POLICY.primaryVenue,
      configuration: {
        executionMode: env.EXECUTION_MODE,
        binanceTrEnabled: true,
      },
      workflow: [
        "Resolve adapter via factory",
        "Normalize symbol rules and filters",
        "Place/cancel/status via adapter",
        "Map errors through error-mapper",
      ],
      deploymentChecks: [
        "GET /api/exchange/balance responds",
        "GET /api/exchange/policy returns policy snapshot",
        "npm run test:run -- tests/binance-tr.adapter.test.ts",
      ],
    });
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
