import { getKlines } from "@/services/binance.service";
import type { MicroStructureAnalysis } from "@/src/server/entry-timing/entry-timing.types";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

type Candle = { open: number; high: number; low: number; close: number; volume: number; openTime: number };

function findSwingHighs(candles: Candle[], lookback = 3): number[] {
  const highs: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const h = candles[i]!.high;
    if (candles.slice(i - lookback, i).every((c) => h >= c.high) && candles.slice(i + 1, i + lookback + 1).every((c) => h >= c.high)) {
      highs.push(h);
    }
  }
  return highs;
}

function findSwingLows(candles: Candle[], lookback = 3): number[] {
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const l = candles[i]!.low;
    if (candles.slice(i - lookback, i).every((c) => l <= c.low) && candles.slice(i + 1, i + lookback + 1).every((c) => l <= c.low)) {
      lows.push(l);
    }
  }
  return lows;
}

export async function analyzeMicroStructure(symbol: string): Promise<MicroStructureAnalysis> {
  const rows = await getKlines(symbol, "5m", 60).catch(() => []);
  const candles: Candle[] = rows.map((r) => ({
    open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, openTime: r.openTime,
  }));

  if (candles.length < 10) {
    return {
      microTrend: "NEUTRAL", swingHigh: null, swingLow: null,
      higherHigh: false, higherLow: false, lowerHigh: false, lowerLow: false,
      bos: false, choch: false, volumeExpansion: false, volumeContraction: false, signals: [],
    };
  }

  const swingHighs = findSwingHighs(candles);
  const swingLows = findSwingLows(candles);
  const swingHigh = swingHighs.at(-1) ?? null;
  const swingLow = swingLows.at(-1) ?? null;
  const higherHigh = swingHighs.length >= 2 && swingHighs.at(-1)! > swingHighs.at(-2)!;
  const higherLow = swingLows.length >= 2 && swingLows.at(-1)! > swingLows.at(-2)!;
  const lowerHigh = swingHighs.length >= 2 && swingHighs.at(-1)! < swingHighs.at(-2)!;
  const lowerLow = swingLows.length >= 2 && swingLows.at(-1)! < swingLows.at(-2)!;

  const recent = candles.slice(-10);
  const prior = candles.slice(-20, -10);
  const recentVol = recent.reduce((s, c) => s + c.volume, 0) / recent.length;
  const priorVol = prior.length > 0 ? prior.reduce((s, c) => s + c.volume, 0) / prior.length : recentVol;
  const volumeExpansion = recentVol > priorVol * 1.3;
  const volumeContraction = recentVol < priorVol * 0.7;

  const lastClose = candles.at(-1)!.close;
  const prevSwingHigh = swingHighs.at(-2);
  const bos = Boolean(prevSwingHigh && lastClose > prevSwingHigh && higherHigh);
  const choch = Boolean(lowerLow && higherHigh);

  let microTrend: MicroStructureAnalysis["microTrend"] = "NEUTRAL";
  if (higherHigh && higherLow) microTrend = "BULLISH";
  else if (lowerHigh && lowerLow) microTrend = "BEARISH";

  const signals: string[] = [];
  if (higherHigh) signals.push("HIGHER_HIGH");
  if (higherLow) signals.push("HIGHER_LOW");
  if (lowerHigh) signals.push("LOWER_HIGH");
  if (lowerLow) signals.push("LOWER_LOW");
  if (bos) signals.push("BOS");
  if (choch) signals.push("CHOCH");
  if (volumeExpansion) signals.push("VOLUME_EXPANSION");
  if (volumeContraction) signals.push("VOLUME_CONTRACTION");
  if (swingHigh) signals.push("SWING_HIGH");
  if (swingLow) signals.push("SWING_LOW");

  return {
    microTrend, swingHigh, swingLow, higherHigh, higherLow, lowerHigh, lowerLow,
    bos, choch, volumeExpansion, volumeContraction, signals,
  };
}

export function structureScoreFromMicro(micro: MicroStructureAnalysis): number {
  let score = 50;
  if (micro.microTrend === "BULLISH") score += 20;
  if (micro.microTrend === "BEARISH") score -= 25;
  if (micro.higherHigh && micro.higherLow) score += 15;
  if (micro.bos) score += 10;
  if (micro.choch) score -= 15;
  if (micro.volumeExpansion) score += 8;
  if (micro.volumeContraction) score -= 5;
  return clamp(score);
}
