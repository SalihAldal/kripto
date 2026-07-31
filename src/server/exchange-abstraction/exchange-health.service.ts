import type { ExchangePluginType } from "@prisma/client";
import { getExchangePlugin } from "@/src/server/exchange-abstraction/plugin-registry.service";
import { withRateLimit } from "@/src/server/exchange-abstraction/rate-limit-manager.service";
import {
  persistExchangeHealth,
  persistExchangeLatency,
  upsertExchangeCapability,
  upsertExchangeRegistry,
  getRegistryByPlugin,
} from "@/src/server/exchange-abstraction/exchange-abstraction.repository";
import { emitExchangeEvent, EXCHANGE_EVENT } from "@/src/server/exchange-abstraction/exchange-abstraction.events";

export async function checkExchangeHealth(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const adapter = getExchangePlugin(pluginType);
  const start = Date.now();
  const health = await withRateLimit(pluginType, () => adapter.health());
  const latencyMs = Date.now() - start;

  let registry = await getRegistryByPlugin(pluginType);
  if (!registry) {
    const created = await upsertExchangeRegistry({
      pluginType,
      displayName: adapter.displayName,
      isProduction: pluginType === "BINANCE_SPOT",
    });
    await upsertExchangeCapability(created.id, adapter.getCapabilities());
    registry = await getRegistryByPlugin(pluginType);
  }
  if (!registry) return { pluginType, health: null, reason: "Registry unavailable" };

  await persistExchangeHealth(registry.id, health);
  await persistExchangeLatency(registry.id, "health", latencyMs, health.availability > 50);

  emitExchangeEvent(EXCHANGE_EVENT.HEALTH_UPDATED, { pluginType, availability: health.availability, latencyMs });
  return { pluginType, health, latencyMs };
}

export async function probeLatency(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const adapter = getExchangePlugin(pluginType);
  const endpoints = ["ticker", "orderbook", "exchangeInfo"];
  const results = [];

  let registry = await getRegistryByPlugin(pluginType);
  if (!registry) {
    await upsertExchangeRegistry({ pluginType, displayName: adapter.displayName, isProduction: pluginType === "BINANCE_SPOT" });
    registry = await getRegistryByPlugin(pluginType);
  }
  if (!registry) return { pluginType, results: [] };

  const registryId = registry.id;

  for (const endpoint of endpoints) {
    const start = Date.now();
    let success = true;
    try {
      await withRateLimit(pluginType, () => adapter.getExchangeInfo());
    } catch {
      success = false;
    }
    const latencyMs = Date.now() - start;
    await persistExchangeLatency(registryId, endpoint, latencyMs, success);
    results.push({ endpoint, latencyMs, success });
    emitExchangeEvent(EXCHANGE_EVENT.LATENCY_RECORDED, { pluginType, endpoint, latencyMs });
  }

  return { pluginType, results };
}
