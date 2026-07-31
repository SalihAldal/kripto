import { checkExchangeHealth, probeLatency } from "@/src/server/exchange-abstraction/exchange-health.service";
import { syncSymbols } from "@/src/server/exchange-abstraction/symbol-sync.service";
import { syncBalances } from "@/src/server/exchange-abstraction/balance-sync.service";
import { monitorConnections, reconnectExchange } from "@/src/server/exchange-abstraction/connection-manager.service";
import { getRateLimitStatus } from "@/src/server/exchange-abstraction/rate-limit-manager.service";
import type { ExchangeAbstractionJobPayload } from "@/src/server/exchange-abstraction/exchange-abstraction.types";

export async function runExchangeAbstractionJob(payload: ExchangeAbstractionJobPayload) {
  const pluginType = payload.pluginType ?? "BINANCE_SPOT";

  switch (payload.type) {
    case "HEALTH_CHECK":
      return checkExchangeHealth(pluginType);
    case "SYMBOL_SYNC":
      return syncSymbols(pluginType);
    case "BALANCE_SYNC":
      return syncBalances(pluginType);
    case "CONNECTION_MONITOR":
      return monitorConnections(pluginType);
    case "RATE_LIMIT_SYNC":
      return getRateLimitStatus(pluginType);
    case "RECONNECT":
      return reconnectExchange(pluginType);
    case "LATENCY_PROBE":
      return probeLatency(pluginType);
    default:
      return { skipped: true };
  }
}
