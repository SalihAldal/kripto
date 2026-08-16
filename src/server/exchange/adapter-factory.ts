import { env } from "@/lib/config";
import type { ExchangeAdapter } from "@/src/types/exchange-adapter";
import { BinanceTrExchangeAdapter } from "@/src/server/exchange/adapters/binance-tr.adapter";

/** Stable exchange adapter policy contract for API/status consumers. */
export const EXCHANGE_ADAPTER_POLICY = {
  primaryVenue: "BINANCE_TR" as const,
  normalizedErrorMapping: true,
  adapterFactorySingleton: true,
  preTradeSymbolRulesRequired: true,
};

let cachedAdapter: ExchangeAdapter | null = null;

export function getExchangeAdapter(): ExchangeAdapter {
  if (!cachedAdapter) {
    // Simdilik BinanceTR odakli; farkli borsa eklendiginde buraya adapter switch eklenecek.
    cachedAdapter = new BinanceTrExchangeAdapter();
  }
  return cachedAdapter;
}

export function resetExchangeAdapterForTests() {
  if (env.NODE_ENV === "test") {
    cachedAdapter = null;
  }
}
