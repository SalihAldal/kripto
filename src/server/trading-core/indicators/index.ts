import type { IndicatorSnapshot, MarketCandle } from "@/src/server/trading-core/core/types";
import { calculateEma } from "@/src/server/trading-core/indicators/ema";
import { calculateMacd } from "@/src/server/trading-core/indicators/macd";
import { calculateRsi } from "@/src/server/trading-core/indicators/rsi";
import { calculateVolumeSpike } from "@/src/server/trading-core/indicators/volume-spike";

export function buildIndicatorSnapshot(candles: MarketCandle[]): IndicatorSnapshot {
  const closes = candles.map((candle) => candle.close).filter(Number.isFinite);
  const volumes = candles.map((candle) => candle.volume).filter(Number.isFinite);
  return {
    rsi: calculateRsi(closes) ?? undefined,
    emaFast: calculateEma(closes, 12) ?? undefined,
    emaSlow: calculateEma(closes, 26) ?? undefined,
    macd: calculateMacd(closes) ?? undefined,
    volumeSpike: calculateVolumeSpike(volumes) ?? undefined,
  };
}
