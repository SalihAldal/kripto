import { getExchangeInfo, listTradableUsdtSymbols } from "@/services/binance.service";
import type { UniverseSymbol } from "@/src/server/discovery/discovery.types";
import type { ExchangeUniverseProvider } from "@/src/server/discovery/exchange/exchange-universe.provider";

function isLeveragedTokenSymbol(symbol: string) {
  return symbol.includes("UPUSDT") || symbol.includes("DOWNUSDT") || symbol.includes("BULLUSDT") || symbol.includes("BEARUSDT");
}

function parseBaseQuote(symbol: string) {
  if (symbol.endsWith("USDT")) {
    return { baseAsset: symbol.slice(0, -4), quoteAsset: "USDT" };
  }
  if (symbol.endsWith("USDC")) {
    return { baseAsset: symbol.slice(0, -4), quoteAsset: "USDC" };
  }
  return { baseAsset: symbol, quoteAsset: "USDT" };
}

export const binanceSpotUniverseProvider: ExchangeUniverseProvider = {
  id: "binance-spot",
  exchange: "binance",
  marketType: "SPOT",
  async isOnline() {
    try {
      await getExchangeInfo();
      return true;
    } catch {
      return false;
    }
  },
  async listSymbols(limit = 5000) {
    const info = await getExchangeInfo();
    const rows: UniverseSymbol[] = [];
    for (const row of info.symbols) {
      if (row.status !== "TRADING") continue;
      const symbol = row.symbol.toUpperCase();
      if (isLeveragedTokenSymbol(symbol)) continue;
      const { baseAsset, quoteAsset } = parseBaseQuote(symbol);
      rows.push({
        symbol,
        exchange: "binance",
        marketType: "SPOT",
        quoteAsset: row.quoteAsset ?? quoteAsset,
        baseAsset: row.baseAsset ?? baseAsset,
        source: "BINANCE_SPOT",
        status: row.status,
        metadata: {
          source: "binance-spot-exchange-info",
        },
      });
      if (rows.length >= limit) break;
    }
    return rows;
  },
};

export async function listBinanceSpotSymbolsQuick(limit = 1200) {
  const symbols = await listTradableUsdtSymbols(limit);
  return symbols.map((symbol) => {
    const { baseAsset, quoteAsset } = parseBaseQuote(symbol);
    return {
      symbol,
      exchange: "binance",
      marketType: "SPOT" as const,
      quoteAsset,
      baseAsset,
      source: "BINANCE_SPOT" as const,
      status: "TRADING",
    };
  });
}
