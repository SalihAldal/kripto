import type { BacktestMarketData } from "@/src/server/trading-core/backtest/backtest-types";

export function buildSyntheticMarketData(symbols: string[], candlesPerSymbol = 260): BacktestMarketData[] {
  const now = Date.now();
  return symbols.map((symbol, symbolIndex) => {
    const seed = symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    let price = 100 + seed * 1.7 + symbolIndex * 25;
    const candles = Array.from({ length: candlesPerSymbol }).map((_, index) => {
      const wave = Math.sin(index / 8 + symbolIndex) * 0.008;
      const trend = ((index % 90) - 45) * 0.00015;
      const shock = index % 57 === 0 ? 0.018 : 0;
      const open = price;
      const close = price * (1 + wave + trend + shock);
      const high = Math.max(open, close) * (1 + 0.002 + Math.abs(wave));
      const low = Math.min(open, close) * (1 - 0.002 - Math.abs(trend));
      const volume = 1000 + Math.abs(wave) * 80_000 + (index % 13) * 450;
      price = close;
      return {
        symbol: symbol.toUpperCase(),
        openTime: now - (candlesPerSymbol - index) * 60_000,
        closeTime: now - (candlesPerSymbol - index - 1) * 60_000,
        open: Number(open.toFixed(8)),
        high: Number(high.toFixed(8)),
        low: Number(low.toFixed(8)),
        close: Number(close.toFixed(8)),
        volume: Number(volume.toFixed(4)),
      };
    });
    return { symbol: symbol.toUpperCase(), candles };
  });
}
