import type { UniverseSymbol } from "@/src/server/discovery/discovery.types";

export type ExchangeUniverseProvider = {
  id: string;
  exchange: string;
  marketType: UniverseSymbol["marketType"];
  listSymbols(limit?: number): Promise<UniverseSymbol[]>;
  isOnline(): Promise<boolean>;
};

export type ExchangeUniverseRegistry = {
  register(provider: ExchangeUniverseProvider): void;
  listProviders(): ExchangeUniverseProvider[];
  discoverAll(limitPerProvider?: number): Promise<UniverseSymbol[]>;
};

function createRegistry(): ExchangeUniverseRegistry {
  const providers: ExchangeUniverseProvider[] = [];

  return {
    register(provider) {
      if (!providers.some((row) => row.id === provider.id)) {
        providers.push(provider);
      }
    },
    listProviders() {
      return [...providers];
    },
    async discoverAll(limitPerProvider = 5000) {
      const rows: UniverseSymbol[] = [];
      for (const provider of providers) {
        try {
          const online = await provider.isOnline();
          if (!online) continue;
          const batch = await provider.listSymbols(limitPerProvider);
          rows.push(...batch);
        } catch {
          // provider failure must not block other exchanges
        }
      }
      const dedup = new Map<string, UniverseSymbol>();
      for (const row of rows) {
        dedup.set(`${row.exchange}:${row.marketType}:${row.symbol}`, row);
      }
      return Array.from(dedup.values());
    },
  };
}

const globalRef = globalThis as typeof globalThis & { __kineticExchangeUniverseRegistry?: ExchangeUniverseRegistry };

export function getExchangeUniverseRegistry(): ExchangeUniverseRegistry {
  if (!globalRef.__kineticExchangeUniverseRegistry) {
    globalRef.__kineticExchangeUniverseRegistry = createRegistry();
  }
  return globalRef.__kineticExchangeUniverseRegistry;
}
