import { env } from "@/lib/config";
import type { ExchangeAdapter } from "@/src/types/exchange-adapter";
import { BinanceTrExchangeAdapter } from "@/src/server/exchange/adapters/binance-tr.adapter";

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
