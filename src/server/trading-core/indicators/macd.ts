import { calculateEma } from "@/src/server/trading-core/indicators/ema";

export function calculateMacd(closes: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (closes.length < slowPeriod + signalPeriod) return null;

  const macdSeries: number[] = [];
  for (let i = slowPeriod; i <= closes.length; i += 1) {
    const slice = closes.slice(0, i);
    const fast = calculateEma(slice, fastPeriod);
    const slow = calculateEma(slice, slowPeriod);
    if (fast !== null && slow !== null) macdSeries.push(fast - slow);
  }

  const macd = macdSeries[macdSeries.length - 1];
  const signal = calculateEma(macdSeries, signalPeriod);
  if (macd === undefined || signal === null) return null;

  return {
    macd: Number(macd.toFixed(8)),
    signal,
    histogram: Number((macd - signal).toFixed(8)),
  };
}
