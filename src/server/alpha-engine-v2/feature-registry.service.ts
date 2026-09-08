import type { FeatureUnit, FeatureValue } from "./types";

export const FEATURE_REGISTRY_VERSION = "v2.0.0";

export function featureValue(input: {
  name: string;
  value: number;
  unit: FeatureUnit;
  scale: string;
  timestamp: number;
  source: string;
  freshnessMs: number;
}): FeatureValue {
  return { ...input };
}

export function returnPct(closes: number[], idx: number, lookback: number) {
  const entry = closes[idx] ?? 0;
  const past = closes[Math.max(0, idx - lookback)] ?? entry;
  if (entry <= 0 || past <= 0) return 0;
  return ((entry - past) / past) * 100;
}

export function atrPct(
  bars: Array<{ high: number; low: number; close: number }>,
  idx: number,
  period = 14,
) {
  const slice = bars.slice(Math.max(1, idx - period), idx + 1);
  if (slice.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < slice.length; i += 1) {
    sum += Math.max(
      slice[i].high - slice[i].low,
      Math.abs(slice[i].high - slice[i - 1].close),
      Math.abs(slice[i].low - slice[i - 1].close),
    );
  }
  const price = slice.at(-1)?.close ?? 1;
  return price > 0 ? (sum / (slice.length - 1) / price) * 100 : 0;
}

export function volumePersistenceRatio(volumes: number[], idx: number, lookback = 12) {
  const slice = volumes.slice(Math.max(0, idx - lookback), idx + 1);
  if (slice.length < 3) return 1;
  const recent = slice.slice(-3).reduce((s, v) => s + v, 0) / 3;
  const base = slice.slice(0, -3).reduce((s, v) => s + v, 0) / Math.max(slice.length - 3, 1);
  return base > 0 ? recent / base : 1;
}

export function computeResidualReturn(symbolReturn: number, btcReturn: number, beta = 1) {
  return symbolReturn - beta * btcReturn;
}

export function estimateBeta(symbolCloses: number[], btcCloses: number[], idx: number, lookback = 24) {
  const sym: number[] = [];
  const btc: number[] = [];
  for (let i = Math.max(1, idx - lookback); i <= idx; i += 1) {
    const s0 = symbolCloses[i - 1];
    const s1 = symbolCloses[i];
    const b0 = btcCloses[i - 1];
    const b1 = btcCloses[i];
    if (s0 > 0 && s1 > 0 && b0 > 0 && b1 > 0) {
      sym.push((s1 - s0) / s0);
      btc.push((b1 - b0) / b0);
    }
  }
  if (sym.length < 5) return 1;
  const meanSym = sym.reduce((s, v) => s + v, 0) / sym.length;
  const meanBtc = btc.reduce((s, v) => s + v, 0) / btc.length;
  let cov = 0;
  let varBtc = 0;
  for (let i = 0; i < sym.length; i += 1) {
    cov += (sym[i] - meanSym) * (btc[i] - meanBtc);
    varBtc += (btc[i] - meanBtc) ** 2;
  }
  return varBtc > 0 ? cov / varBtc : 1;
}

export function takerBuyRatio(quoteVolume: number, takerBuyQuote: number) {
  if (quoteVolume <= 0) return 0.5;
  return takerBuyQuote / quoteVolume;
}

export function percentileRank(values: number[], value: number) {
  if (!values.length) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  return below / sorted.length;
}
