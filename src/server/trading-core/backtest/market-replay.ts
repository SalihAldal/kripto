import type { BacktestMarketData } from "@/src/server/trading-core/backtest/backtest-types";
import type { MarketCandle, MarketSnapshot } from "@/src/server/trading-core/core/types";

export class MarketReplay {
  constructor(
    private readonly data: BacktestMarketData[],
    private readonly lookback = 80,
  ) {}

  *snapshots(): Generator<MarketSnapshot> {
    for (const item of this.data) {
      const candles = [...item.candles].sort((a, b) => a.closeTime - b.closeTime);
      for (let index = Math.max(2, this.lookback); index <= candles.length; index += 1) {
        const window = candles.slice(Math.max(0, index - this.lookback), index);
        const latest = window[window.length - 1] as MarketCandle;
        yield {
          symbol: item.symbol.toUpperCase(),
          candles: window,
          latestTick: {
            symbol: item.symbol.toUpperCase(),
            price: latest.close,
            volume: latest.volume,
            eventTime: latest.closeTime,
          },
          receivedAt: new Date(latest.closeTime).toISOString(),
        };
      }
    }
  }
}
