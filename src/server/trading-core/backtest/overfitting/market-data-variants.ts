import type { BacktestMarketData } from "@/src/server/trading-core/backtest/backtest-types";

export function splitOutOfSample(marketData: BacktestMarketData[], trainRatio = 0.7) {
  return {
    train: marketData.map((row) => {
      const split = Math.max(1, Math.floor(row.candles.length * trainRatio));
      return { symbol: row.symbol, candles: row.candles.slice(0, split) };
    }),
    test: marketData.map((row) => {
      const split = Math.max(1, Math.floor(row.candles.length * trainRatio));
      return { symbol: row.symbol, candles: row.candles.slice(split) };
    }),
  };
}

export function regimeVariants(marketData: BacktestMarketData[]) {
  return [
    {
      name: "bullish",
      data: marketData.map((row) => ({ symbol: row.symbol, candles: row.candles.filter((candle) => candle.close >= candle.open) })),
    },
    {
      name: "bearish",
      data: marketData.map((row) => ({ symbol: row.symbol, candles: row.candles.filter((candle) => candle.close < candle.open) })),
    },
    {
      name: "high_volatility",
      data: marketData.map((row) => {
        const ranked = [...row.candles].sort((a, b) => Math.abs(b.high - b.low) / b.close - Math.abs(a.high - a.low) / a.close);
        return { symbol: row.symbol, candles: ranked.slice(0, Math.max(30, Math.floor(ranked.length * 0.35))).sort((a, b) => a.openTime - b.openTime) };
      }),
    },
  ].filter((variant) => variant.data.every((row) => row.candles.length >= 20));
}

export function randomizeCandles(marketData: BacktestMarketData[], seed: number) {
  return marketData.map((row) => {
    const candles = [...row.candles];
    for (let i = candles.length - 1; i > 0; i -= 1) {
      const j = Math.abs((seed * 9301 + i * 49297) % 233280) % (i + 1);
      [candles[i], candles[j]] = [candles[j], candles[i]];
    }
    let time = row.candles[0]?.openTime ?? Date.now();
    return {
      symbol: row.symbol,
      candles: candles.map((candle) => {
        const next = { ...candle, openTime: time, closeTime: time + 60_000 - 1 };
        time += 60_000;
        return next;
      }),
    };
  });
}

export function monteCarloCandles(marketData: BacktestMarketData[], seed: number) {
  const factor = 1 + (((seed % 17) - 8) / 1000);
  return marketData.map((row) => ({
    symbol: row.symbol,
    candles: row.candles.map((candle, index) => {
      const noise = 1 + (Math.sin(seed + index) * 0.002 + (index % 7) * 0.0002);
      return {
        ...candle,
        open: Number((candle.open * factor * noise).toFixed(8)),
        high: Number((candle.high * factor * Math.max(noise, 1)).toFixed(8)),
        low: Number((candle.low * factor * Math.min(noise, 1)).toFixed(8)),
        close: Number((candle.close * factor * noise).toFixed(8)),
      };
    }),
  }));
}
