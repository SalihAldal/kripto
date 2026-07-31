import type { UniverseSymbol } from "@/src/server/discovery/discovery.types";
import type { ExchangeUniverseProvider } from "@/src/server/discovery/exchange/exchange-universe.provider";

type FuturesExchangeInfo = {
  symbols?: Array<{
    symbol: string;
    status: string;
    baseAsset?: string;
    quoteAsset?: string;
    contractType?: string;
  }>;
};

async function fetchFuturesExchangeInfo(): Promise<FuturesExchangeInfo | null> {
  const baseUrl = "https://fapi.binance.com";
  try {
    const response = await fetch(`${baseUrl}/fapi/v1/exchangeInfo`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as FuturesExchangeInfo;
  } catch {
    return null;
  }
}

export const binanceFuturesUniverseProvider: ExchangeUniverseProvider = {
  id: "binance-futures",
  exchange: "binance",
  marketType: "FUTURES",
  async isOnline() {
    const info = await fetchFuturesExchangeInfo();
    return Boolean(info?.symbols?.length);
  },
  async listSymbols(limit = 5000) {
    const info = await fetchFuturesExchangeInfo();
    if (!info?.symbols?.length) return [];
    const rows: UniverseSymbol[] = [];
    for (const row of info.symbols) {
      if (row.status !== "TRADING") continue;
      if (row.contractType && row.contractType !== "PERPETUAL") continue;
      const symbol = row.symbol.toUpperCase();
      rows.push({
        symbol,
        exchange: "binance",
        marketType: "FUTURES",
        quoteAsset: row.quoteAsset ?? "USDT",
        baseAsset: row.baseAsset,
        source: "BINANCE_FUTURES",
        status: row.status,
        metadata: { contractType: row.contractType },
      });
      if (rows.length >= limit) break;
    }
    return rows;
  },
};
