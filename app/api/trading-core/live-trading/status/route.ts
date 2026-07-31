import { NextRequest } from "next/server";
import { env } from "@/lib/config";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { validateGoLiveChecklist } from "@/src/server/live-trading/go-live-validator.service";
import { isCircuitBreakerActive } from "@/src/server/live-trading/circuit-breaker.service";
import { isKillSwitchActive } from "@/src/server/live-trading/kill-switch.service";
import { getLatestHealth } from "@/src/server/live-trading/live-health.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user?.id;
    if (!userId) return apiErrorFromUnknown(new Error("userId required"));

    const [goLive, circuitBreaker, killSwitch, health] = await Promise.all([
      validateGoLiveChecklist(userId),
      isCircuitBreakerActive(userId),
      isKillSwitchActive(userId),
      getLatestHealth(userId),
    ]);

    return apiOkFromRequest(request, {
      platformEnabled: env.LIVE_TRADING_PLATFORM_ENABLED,
      executionMode: env.EXECUTION_MODE,
      goLiveRequired: env.LIVE_TRADING_REQUIRE_GO_LIVE_GATE,
      goLive,
      circuitBreakerActive: circuitBreaker,
      killSwitchActive: killSwitch,
      health,
      liveReady: goLive.passed && !circuitBreaker && !killSwitch,
      autoLiveEnabled: false,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
