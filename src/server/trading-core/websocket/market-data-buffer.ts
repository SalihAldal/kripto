import type { MarketCandle, MarketSnapshot, MarketTick } from "@/src/server/trading-core/core/types";
import { MissingCandleRepair, marketDataNormalizer } from "@/src/server/trading-core/market-data";

type MutableCandle = MarketCandle;

export class MarketDataBuffer {
  private readonly candles = new Map<string, MutableCandle[]>();
  private readonly latestTicks = new Map<string, MarketTick>();
  private readonly repair: MissingCandleRepair;

  constructor(
    private readonly candleIntervalMs = 60_000,
    private readonly maxCandlesPerSymbol = 240,
  ) {
    this.repair = new MissingCandleRepair(candleIntervalMs);
  }

  ingestTick(tick: MarketTick) {
    const normalized = marketDataNormalizer.fromMarketTick(tick, "BINANCE");
    if (!normalized) return;
    const cleanTick = marketDataNormalizer.toMarketTick(normalized);
    const symbol = cleanTick.symbol.toUpperCase();
    const bucketStart = Math.floor(cleanTick.eventTime / this.candleIntervalMs) * this.candleIntervalMs;
    const bucketEnd = bucketStart + this.candleIntervalMs - 1;
    const rows = this.candles.get(symbol) ?? [];
    const last = rows[rows.length - 1];
    const volume = cleanTick.volume ?? 0;

    if (!last || last.openTime !== bucketStart) {
      rows.push({
        symbol,
        openTime: bucketStart,
        closeTime: bucketEnd,
        open: cleanTick.price,
        high: cleanTick.price,
        low: cleanTick.price,
        close: cleanTick.price,
        volume,
      });
      if (rows.length > this.maxCandlesPerSymbol) {
        rows.splice(0, rows.length - this.maxCandlesPerSymbol);
      }
      this.candles.set(symbol, rows);
    } else {
      last.high = Math.max(last.high, cleanTick.price);
      last.low = Math.min(last.low, cleanTick.price);
      last.close = cleanTick.price;
      last.volume = Math.max(last.volume, volume);
    }

    this.latestTicks.set(symbol, cleanTick);
  }

  getSnapshot(symbol: string): MarketSnapshot | null {
    const normalized = symbol.toUpperCase();
    const rows = this.candles.get(normalized) ?? [];
    if (rows.length === 0) return null;
    return {
      symbol: normalized,
      candles: this.repair.repair(rows.map((row) => ({ ...row })), "BINANCE").slice(-this.maxCandlesPerSymbol),
      latestTick: this.latestTicks.get(normalized),
      receivedAt: new Date().toISOString(),
    };
  }

  stats() {
    return {
      symbols: this.candles.size,
      candles: Array.from(this.candles.entries()).map(([symbol, rows]) => ({
        symbol,
        count: rows.length,
      })),
      normalization: marketDataNormalizer.snapshot(),
    };
  }
}
