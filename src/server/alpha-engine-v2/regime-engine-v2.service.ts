import { atrPct, returnPct } from "./feature-registry.service";
import { assertNoLookahead } from "./lookahead-guard";
import type { HistoricalBar } from "./historical-alpha-simulator.service";

export const REGIME_ENGINE_VERSION = "v2.0.0";

export type CompositeRegime =
  | "UPTREND_HIGH_VOL"
  | "UPTREND_LOW_VOL"
  | "DOWNTREND_HIGH_VOL"
  | "DOWNTREND_LOW_VOL"
  | "SIDEWAYS"
  | "TRANSITION";

export type RegimeFeatures = {
  timestamp: number;
  btcReturn1h: number;
  btcReturn4h: number;
  btcReturn12h: number;
  btcReturn24h: number;
  emaSlope: number;
  trendStrength: number;
  realizedVol: number;
  atrPercentile: number;
  volumeRegime: number;
};

export type RegimeSnapshot = {
  timestamp: number;
  regime: CompositeRegime;
  features: RegimeFeatures;
  previousRegime?: CompositeRegime;
  isTransition: boolean;
};

function emaSlope(closes: number[], idx: number, period = 20) {
  const slice = closes.slice(Math.max(0, idx - period), idx + 1);
  if (slice.length < 3) return 0;
  const ema: number[] = [];
  const k = 2 / (period + 1);
  let prev = slice[0];
  ema.push(prev);
  for (let i = 1; i < slice.length; i += 1) {
    prev = slice[i] * k + prev * (1 - k);
    ema.push(prev);
  }
  const last = ema.at(-1) ?? 0;
  const prior = ema.at(-2) ?? last;
  if (prior === 0) return 0;
  return ((last - prior) / prior) * 100;
}

function realizedVolatility(closes: number[], idx: number, lookback = 24) {
  const rets: number[] = [];
  for (let i = Math.max(1, idx - lookback); i <= idx; i += 1) {
    const p0 = closes[i - 1];
    const p1 = closes[i];
    if (p0 > 0 && p1 > 0) rets.push((p1 - p0) / p0);
  }
  if (rets.length < 2) return 0;
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * 100;
}

function atrPercentile(btc: HistoricalBar[], idx: number, lookback = 168) {
  const current = atrPct(btc, idx, 14);
  const samples: number[] = [];
  for (let i = Math.max(14, idx - lookback); i <= idx; i += 1) {
    samples.push(atrPct(btc, i, 14));
  }
  if (!samples.length) return 0.5;
  const below = samples.filter((v) => v < current).length;
  return below / samples.length;
}

function volumeRegime(btc: HistoricalBar[], idx: number, lookback = 24) {
  const recent = btc.slice(Math.max(0, idx - 3), idx + 1).reduce((s, b) => s + b.volume, 0) / 4;
  const base = btc.slice(Math.max(0, idx - lookback), idx - 3).reduce((s, b) => s + b.volume, 0) / Math.max(lookback - 3, 1);
  return base > 0 ? recent / base : 1;
}

function baseTrend(r24: number): "UP" | "DOWN" | "SIDE" {
  if (r24 > 1.0) return "UP";
  if (r24 < -1.0) return "DOWN";
  return "SIDE";
}

export function classifyRegimeAtBar(btc: HistoricalBar[], idx: number, previous?: CompositeRegime): RegimeSnapshot {
  const closes = btc.map((b) => b.close);
  const bar = btc[idx];
  const timestamp = bar?.closeTime ?? 0;
  const features: RegimeFeatures = {
    timestamp,
    btcReturn1h: returnPct(closes, idx, 1),
    btcReturn4h: returnPct(closes, idx, 4),
    btcReturn12h: returnPct(closes, idx, 12),
    btcReturn24h: returnPct(closes, idx, 24),
    emaSlope: emaSlope(closes, idx, 20),
    trendStrength: Math.abs(returnPct(closes, idx, 24)),
    realizedVol: realizedVolatility(closes, idx, 24),
    atrPercentile: atrPercentile(btc, idx, 168),
    volumeRegime: volumeRegime(btc, idx, 24),
  };

  const trend = baseTrend(features.btcReturn24h);
  const highVol = features.atrPercentile >= 0.65 || features.realizedVol > 2.0;

  let regime: CompositeRegime =
    trend === "UP"
      ? highVol
        ? "UPTREND_HIGH_VOL"
        : "UPTREND_LOW_VOL"
      : trend === "DOWN"
        ? highVol
          ? "DOWNTREND_HIGH_VOL"
          : "DOWNTREND_LOW_VOL"
        : "SIDEWAYS";

  const signFlip =
    previous &&
    ((previous.startsWith("UPTREND") && regime.startsWith("DOWNTREND")) ||
      (previous.startsWith("DOWNTREND") && regime.startsWith("UPTREND")));
  const rapidTrendChange = Math.abs(features.btcReturn4h) > 1.5 && Math.sign(features.btcReturn4h) !== Math.sign(features.btcReturn24h);
  const isTransition = Boolean(signFlip || rapidTrendChange || (previous && previous !== regime && features.trendStrength < 0.6));
  if (isTransition) regime = "TRANSITION";

  return { timestamp, regime, features, previousRegime: previous, isTransition };
}

export function buildRegimeTimeline(btc: HistoricalBar[], startIdx = 48): RegimeSnapshot[] {
  const timeline: RegimeSnapshot[] = [];
  let prev: CompositeRegime | undefined;
  for (let idx = startIdx; idx < btc.length; idx += 1) {
    const snap = classifyRegimeAtBar(btc, idx, prev);
    assertNoLookahead(snap.timestamp, snap.timestamp, "regime");
    timeline.push(snap);
    if (!snap.isTransition) prev = snap.regime;
  }
  return timeline;
}

export function regimeAtTime(timeline: RegimeSnapshot[], time: number): RegimeSnapshot | null {
  let best: RegimeSnapshot | null = null;
  for (const row of timeline) {
    if (row.timestamp <= time) best = row;
  }
  return best;
}
