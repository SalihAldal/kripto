import { apiOk } from "@/lib/api";
import { getExchangeProvider } from "@/src/server/exchange";
import { listHeartbeats, markHeartbeat } from "@/src/server/observability/heartbeat";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import { validateStartupConfig } from "@/src/server/startup/validate-startup";
import { runRestartRecovery, getSafeModeState } from "@/src/server/recovery/failsafe-recovery.service";

export async function GET() {
  validateStartupConfig();
  let exchangeEndpoints: ReturnType<ReturnType<typeof getExchangeProvider>["getPublicEndpointHealth"]> = [];
  let exchangeRuntime: ReturnType<ReturnType<typeof getExchangeProvider>["getRuntimeStatus"]> = {
    fallbackActive: false,
    globalBanActive: false,
    networkCooldownActive: false,
    globalBanUntil: null,
    networkCooldownUntil: null,
  };
  try {
    const provider = getExchangeProvider();
    exchangeEndpoints = provider.getPublicEndpointHealth();
    exchangeRuntime = provider.getRuntimeStatus();
    const hasHardFailures = exchangeEndpoints.some((row) => row.consecutiveFailures >= 3);
    markHeartbeat({
      service: "exchange-endpoints",
      status: hasHardFailures ? "DEGRADED" : "UP",
      message: hasHardFailures ? "Some exchange endpoints are degraded" : "Exchange endpoints healthy",
      details: { top: exchangeEndpoints.slice(0, 3) },
    });
  } catch {
    markHeartbeat({
      service: "exchange-endpoints",
      status: "DEGRADED",
      message: "Exchange endpoint telemetry unavailable",
    });
  }
  markHeartbeat({ service: "health", status: "UP", message: "Health endpoint ping" });
  const recovery = await runRestartRecovery().catch(() => null);
  const safeMode = await getSafeModeState().catch(() => ({
    enabled: false,
    requireManualAck: false,
    updatedAt: new Date().toISOString(),
  }));
  return apiOk({
    status: "healthy",
    timestamp: new Date().toISOString(),
    heartbeats: listHeartbeats(),
    circuits: getCircuitSnapshot(),
    exchangeEndpoints,
    exchangeRuntime,
    recovery,
    safeMode,
  });
}
