import type { MarketCandle } from "@/src/server/trading-core/core/types";
import { marketDataNormalizer } from "@/src/server/trading-core/market-data/market-data-normalizer";
import type { MarketDataSource } from "@/src/server/trading-core/market-data/market-data-types";

export class MissingCandleRepair {
  constructor(private readonly candleIntervalMs = 60_000) {}

  repair(candles: MarketCandle[], source: MarketDataSource = "UNKNOWN") {
    if (candles.length < 2) return candles;
    const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
    const repaired: MarketCandle[] = [];
    let repairCount = 0;
    for (const candle of sorted) {
      const previous = repaired[repaired.length - 1];
      if (previous) {
        let nextOpen = previous.openTime + this.candleIntervalMs;
        while (nextOpen < candle.openTime) {
          repairCount += 1;
          repaired.push({
            symbol: candle.symbol,
            openTime: nextOpen,
            closeTime: nextOpen + this.candleIntervalMs - 1,
            open: previous.close,
            high: previous.close,
            low: previous.close,
            close: previous.close,
            volume: 0,
          });
          nextOpen += this.candleIntervalMs;
        }
      }
      repaired.push(candle);
    }
    if (repairCount > 0) marketDataNormalizer.markRepaired(source, sorted[0]?.symbol ?? "UNKNOWN", repairCount);
    return repaired;
  }
}
