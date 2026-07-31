import type { ExchangePluginType } from "@prisma/client";
import { getExchangePlugin } from "@/src/server/exchange-abstraction/plugin-registry.service";
import { withRateLimit } from "@/src/server/exchange-abstraction/rate-limit-manager.service";
import { upsertCanonicalSymbol, upsertExchangeRegistry, getRegistryByPlugin, upsertExchangeCapability } from "@/src/server/exchange-abstraction/exchange-abstraction.repository";
import { buildPrecisionRules } from "@/src/server/exchange-abstraction/precision-layer.service";
import { emitExchangeEvent, EXCHANGE_EVENT } from "@/src/server/exchange-abstraction/exchange-abstraction.events";

export async function syncSymbols(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const adapter = getExchangePlugin(pluginType);
  if (!adapter.isAvailable) return { synced: 0, reason: "Adapter unavailable" };

  let registry = await getRegistryByPlugin(pluginType);
  if (!registry) {
    const created = await upsertExchangeRegistry({ pluginType, displayName: adapter.displayName, isProduction: pluginType === "BINANCE_SPOT" });
    await upsertExchangeCapability(created.id, adapter.getCapabilities());
    registry = await getRegistryByPlugin(pluginType);
  }
  if (!registry) return { synced: 0, reason: "Registry unavailable" };

  const symbols = await withRateLimit(pluginType, () => adapter.getSymbols());
  let synced = 0;

  for (const sym of symbols.slice(0, 500)) {
    try {
      const precision = await adapter.getPrecision(sym.canonicalSymbol).catch(() =>
        buildPrecisionRules({ canonicalSymbol: sym.canonicalSymbol, tickSize: 0.01, stepSize: 0.001, minNotional: 5, minQty: 0.001 }),
      );
      await upsertCanonicalSymbol({
        baseAsset: sym.baseAsset,
        quoteAsset: sym.quoteAsset,
        canonicalSymbol: sym.canonicalSymbol,
        pluginType,
        exchangeSymbol: sym.exchangeSymbol,
        precision,
      });
      synced++;
    } catch {
      // skip invalid symbols
    }
  }

  emitExchangeEvent(EXCHANGE_EVENT.SYMBOLS_SYNCED, { pluginType, synced });
  return { synced, total: symbols.length };
}
