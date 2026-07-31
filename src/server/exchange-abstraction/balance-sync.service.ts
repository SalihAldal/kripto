import type { ExchangePluginType } from "@prisma/client";
import { getExchangePlugin } from "@/src/server/exchange-abstraction/plugin-registry.service";
import { withRateLimit } from "@/src/server/exchange-abstraction/rate-limit-manager.service";
import { upsertCanonicalBalance, upsertExchangeRegistry, getRegistryByPlugin } from "@/src/server/exchange-abstraction/exchange-abstraction.repository";
import { emitExchangeEvent, EXCHANGE_EVENT } from "@/src/server/exchange-abstraction/exchange-abstraction.events";

export async function syncBalances(pluginType: ExchangePluginType = "BINANCE_SPOT") {
  const adapter = getExchangePlugin(pluginType);
  if (!adapter.isAvailable) return { synced: 0, reason: "Adapter unavailable" };

  let registry = await getRegistryByPlugin(pluginType);
  if (!registry) {
    const created = await upsertExchangeRegistry({ pluginType, displayName: adapter.displayName, isProduction: pluginType === "BINANCE_SPOT" });
    registry = await getRegistryByPlugin(pluginType);
  }
  if (!registry) return { synced: 0, reason: "Registry unavailable" };

  const balances = await withRateLimit(pluginType, () => adapter.getBalance());
  let synced = 0;

  for (const balance of balances.filter((b) => b.total > 0)) {
    await upsertCanonicalBalance(pluginType, balance, registry.accountLabel ?? undefined);
    synced++;
  }

  emitExchangeEvent(EXCHANGE_EVENT.BALANCES_SYNCED, { pluginType, synced });
  return { synced, total: balances.length };
}
