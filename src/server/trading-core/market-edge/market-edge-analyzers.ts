import type { BacktestTrade } from "@/src/server/trading-core/backtest/backtest-types";
import type { MarketCandle } from "@/src/server/trading-core/core/types";
import type { LiquidationHeatmapAnalysis } from "@/src/server/trading-core/liquidation-heatmap";
import type { EdgeConditionType, MarketEdgeSample } from "@/src/server/trading-core/market-edge/market-edge-types";

function candleVolatility(candle: MarketCandle) {
  return candle.close > 0 ? ((candle.high - candle.low) / candle.close) * 100 : 0;
}

function volumeRatio(candles: MarketCandle[], index: number) {
  const lookback = candles.slice(Math.max(0, index - 20), index);
  const avg = lookback.reduce((sum, candle) => sum + candle.volume, 0) / Math.max(1, lookback.length);
  return avg > 0 ? candles[index].volume / avg : 0;
}

export class MarketEdgeSampleBuilder {
  fromMarketData(marketData: Array<{ symbol: string; candles: MarketCandle[] }>): MarketEdgeSample[] {
    return marketData.flatMap(({ symbol, candles }) =>
      candles.map((candle, index) => {
        const rangeBreakout = index > 20 && candle.close > Math.max(...candles.slice(index - 20, index).map((row) => row.high));
        const downBreakout = index > 20 && candle.close < Math.min(...candles.slice(index - 20, index).map((row) => row.low));
        const future = candles[index + 3]?.close ?? candle.close;
        const returnPercent = candle.close > 0 ? ((future - candle.close) / candle.close) * 100 : 0;
        return {
          symbol,
          timestamp: candle.closeTime,
          volatilityPercent: candleVolatility(candle),
          volumeRatio: volumeRatio(candles, index),
          breakoutDirection: rangeBreakout ? "UP" : downBreakout ? "DOWN" : "NONE",
          breakoutSucceeded: rangeBreakout ? returnPercent > 0 : downBreakout ? returnPercent < 0 : undefined,
          fakeBreakout: rangeBreakout ? returnPercent < -0.2 : downBreakout ? returnPercent > 0.2 : false,
          returnPercent,
        };
      }),
    );
  }

  fromTrades(trades: BacktestTrade[]): MarketEdgeSample[] {
    return trades.map((trade) => ({
      symbol: trade.symbol,
      timestamp: trade.exitTime,
      strategy: trade.strategy,
      breakoutDirection: trade.exitReason === "REVERSE_SIGNAL" ? "NONE" : trade.side === "BUY" ? "UP" : "DOWN",
      breakoutSucceeded: trade.netPnl > 0,
      fakeBreakout: trade.exitReason === "STOP_LOSS",
      returnPercent: trade.returnPercent,
    }));
  }

  fromHeatmaps(heatmaps: LiquidationHeatmapAnalysis[]): MarketEdgeSample[] {
    return heatmaps.map((heatmap) => ({
      symbol: heatmap.symbol,
      timestamp: Date.parse(heatmap.analyzedAt),
      volatilityPercent: undefined,
      fundingRatePercent: heatmap.fundingExtremeScore / 100,
      breakoutDirection: heatmap.squeezeDirection === "UP" ? "UP" : heatmap.squeezeDirection === "DOWN" ? "DOWN" : "NONE",
      fakeBreakout: heatmap.manipulationRiskScore >= 70,
      whaleNotionalUsd: heatmap.clusters.reduce((sum, cluster) => sum + cluster.totalNotionalUsd, 0),
      returnPercent: heatmap.squeezeScore >= 60 && heatmap.manipulationRiskScore < 65 ? 0.35 : -0.2,
    }));
  }
}

export class MarketEdgeConditionClassifier {
  classify(sample: MarketEdgeSample): EdgeConditionType[] {
    return [
      (sample.volatilityPercent ?? 0) >= 3 ? "VOLATILITY_PATTERN" : null,
      Math.abs(sample.fundingRatePercent ?? 0) >= 0.08 ? "FUNDING_EXTREME" : null,
      (sample.volumeRatio ?? 0) >= 2.2 ? "VOLUME_ANOMALY" : null,
      Math.abs(sample.orderbookImbalancePercent ?? 0) >= 25 ? "ORDERBOOK_IMBALANCE" : null,
      (sample.whaleNotionalUsd ?? 0) >= 1_000_000 ? "WHALE_ACTIVITY" : null,
      sample.breakoutSucceeded === true ? "BREAKOUT_SUCCESS" : null,
      sample.fakeBreakout ? "FAKE_BREAKOUT" : null,
      sample.fakeBreakout || (sample.volatilityPercent ?? 0) >= 5 ? "MARKET_INEFFICIENCY" : null,
    ].filter((item): item is EdgeConditionType => Boolean(item));
  }
}
