import type { SymbolMarketSnapshot } from "@/src/server/market-data/spine/events";
import type { TickSample } from "@/src/server/market-data/spine/ring-buffer";
import type { MarketBreadth, OpportunityFeatures } from "@/src/server/opportunity/types";
import { median, nz, percentile } from "@/src/server/opportunity/normalize";

function velocity(ret: number, seconds: number) {
  if (!seconds) return 0;
  return ret / (seconds / 60);
}

export function computeBreadth(rows: SymbolMarketSnapshot[], btc?: SymbolMarketSnapshot | null): MarketBreadth {
  const r1 = rows.map((row) => nz(row.rolling.return1m));
  const r5 = rows.map((row) => nz(row.rolling.return5m));
  const pos1 = r1.filter((v) => v > 0).length;
  const pos5 = r5.filter((v) => v > 0).length;
  return {
    pctPositive1m: rows.length ? (pos1 / rows.length) * 100 : 0,
    pctPositive5m: rows.length ? (pos5 / rows.length) * 100 : 0,
    medianReturn1m: median(r1),
    medianReturn5m: median(r5),
    topDecileReturn1m: percentile(r1, 90),
    btcReturn1m: nz(btc?.rolling.return1m),
    btcReturn5m: nz(btc?.rolling.return5m),
  };
}

export function computeOpportunityFeatures(input: {
  row: SymbolMarketSnapshot;
  window?: TickSample[];
  breadth: MarketBreadth;
  volumeHistory: number[];
}): OpportunityFeatures {
  const { row, window = [], breadth, volumeHistory } = input;
  const r = row.rolling;
  const return1s = nz(r.return1s);
  const return5s = nz(r.return5s);
  const return15s = nz(r.return15s);
  const return30s = nz(r.return30s);
  const return1m = nz(r.return1m);
  const return3m = nz(r.return3m);
  const return5m = nz(r.return5m);
  const return15m = nz(r.return15m);

  const velocity5s = velocity(return5s, 5);
  const velocity15s = velocity(return15s, 15);
  const velocity30s = velocity(return30s, 30);
  const velocity1m = velocity(return1m, 60);
  const priceAccelerationShort = velocity5s - velocity30s;
  const priceAccelerationMedium = velocity1m - velocity(return5m, 300);
  const accelSigns = [priceAccelerationShort, priceAccelerationMedium, return5s - return1s];
  const accelerationConsistency =
    accelSigns.filter((v) => v > 0).length / Math.max(1, accelSigns.length) -
    accelSigns.filter((v) => v < 0).length / Math.max(1, accelSigns.length);

  const volume1m = Math.max(0, nz(r.quoteVolumeDelta));
  const volume3m = volume1m * (nz(r.return3m) !== 0 || volume1m > 0 ? 1 : 0) + volumeFromWindow(window, 180_000);
  const volume5m = volumeFromWindow(window, 300_000) || volume1m;
  const baseline1m = robustBaseline(volumeHistory);
  const rvol1m = baseline1m > 0 ? volume1m / baseline1m : volume1m > 0 ? 2 : 1;
  const rvol3m = baseline1m > 0 ? (volume3m / 3) / baseline1m : rvol1m;
  const rvol5m = baseline1m > 0 ? (volume5m / 5) / baseline1m : rvol1m;
  const prevVol = volumeHistory.length >= 2 ? volumeHistory[volumeHistory.length - 2] : baseline1m;
  const olderVol = volumeHistory.length >= 3 ? volumeHistory[volumeHistory.length - 3] : prevVol;
  const volumeAcceleration = (volume1m - prevVol) - (prevVol - olderVol);

  const highs = rollingHighs(window, row.lastPrice);
  const distanceTo3mHigh = highs.high3m > 0 ? ((highs.high3m - row.lastPrice) / highs.high3m) * 100 : 0;
  const distanceTo5mHigh = highs.high5m > 0 ? ((highs.high5m - row.lastPrice) / highs.high5m) * 100 : 0;
  const breakout3m = distanceTo3mHigh <= 0 ? Math.min(2, Math.abs(distanceTo3mHigh) + 0.2) : Math.max(0, 0.25 - distanceTo3mHigh);
  const breakout5m = distanceTo5mHigh <= 0 ? Math.min(2, Math.abs(distanceTo5mHigh) + 0.2) : Math.max(0, 0.35 - distanceTo5mHigh);

  const rangeShort = rangeOf(window, 30_000, row.lastPrice);
  const rangeMed = rangeOf(window, 300_000, row.lastPrice);
  const compressionScore = rangeMed > 0 ? clamp01(1 - rangeShort / rangeMed) : 0;
  const expansionScore = rangeMed > 0 ? clamp01(rangeShort / rangeMed) : 0;

  const retrace = retracement(window, row.lastPrice);
  const posReturns = [return15s, return30s, return1m, return3m, return5m];
  const posCount = posReturns.filter((v) => v > 0).length;
  const spikeLike = Math.abs(return5s) > Math.abs(return5m) * 0.85 && Math.abs(return5m) > 0.4;
  const momentumConsistency = posCount / posReturns.length - (spikeLike ? 0.35 : 0);

  const exhaustionScore = computeExhaustion({
    return5s,
    return1m,
    return5m,
    volumeAcceleration,
    rvol1m,
    retrace,
    velocity5s,
  });
  const chaseRisk = Math.max(0, return15m - 8) * 0.35 + Math.max(0, row.change24h - 12) * 0.2 + exhaustionScore * 0.4;

  return {
    return1s,
    return5s,
    return15s,
    return30s,
    return1m,
    return3m,
    return5m,
    return15m,
    change24h: nz(row.change24h),
    velocity5s,
    velocity15s,
    velocity30s,
    velocity1m,
    priceAccelerationShort,
    priceAccelerationMedium,
    accelerationConsistency,
    volume1m,
    volume3m,
    volume5m,
    rvol1m,
    rvol3m,
    rvol5m,
    volumeAcceleration,
    relativeStrengthBTC1m: return1m - breadth.btcReturn1m,
    relativeStrengthBTC5m: return5m - breadth.btcReturn5m,
    relativeStrengthMarket: return1m - breadth.medianReturn1m,
    distanceTo3mHigh,
    distanceTo5mHigh,
    breakout3m,
    breakout5m,
    compressionScore,
    expansionScore,
    maxRetracement: retrace.maxRetracement,
    retracementRatio: retrace.retracementRatio,
    recoverySpeed: retrace.recoverySpeed,
    momentumConsistency,
    exhaustionScore,
    chaseRisk,
    quoteVolume24h: row.quoteVolume24h,
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function robustBaseline(history: number[]) {
  const positive = history.filter((v) => v > 0);
  if (!positive.length) return 0;
  const sorted = [...positive].sort((a, b) => a - b);
  const hi = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];
  const capped = sorted.map((v) => Math.min(v, hi));
  return median(capped);
}

function volumeFromWindow(window: TickSample[], durationMs: number) {
  if (window.length < 2) return 0;
  const cutoff = (window[window.length - 1]?.t ?? 0) - durationMs;
  const first = window.find((row) => row.t >= cutoff) ?? window[0];
  const last = window[window.length - 1];
  return Math.max(0, last.quoteVolume - first.quoteVolume);
}

function rollingHighs(window: TickSample[], fallback: number) {
  const now = window[window.length - 1]?.t ?? Date.now();
  let high3m = fallback;
  let high5m = fallback;
  for (const sample of window) {
    if (now - sample.t <= 180_000) high3m = Math.max(high3m, sample.price);
    if (now - sample.t <= 300_000) high5m = Math.max(high5m, sample.price);
  }
  return { high3m, high5m };
}

function rangeOf(window: TickSample[], durationMs: number, fallback: number) {
  const now = window[window.length - 1]?.t ?? Date.now();
  let high = 0;
  let low = Number.POSITIVE_INFINITY;
  for (const sample of window) {
    if (now - sample.t > durationMs) continue;
    high = Math.max(high, sample.price);
    low = Math.min(low, sample.price);
  }
  if (!Number.isFinite(low) || high <= 0) return 0;
  return ((high - low) / (fallback || high)) * 100;
}

function retracement(window: TickSample[], lastPrice: number) {
  if (window.length < 4) {
    return { maxRetracement: 0, retracementRatio: 0, recoverySpeed: 0 };
  }
  let peak = window[0].price;
  let peakT = window[0].t;
  let maxDd = 0;
  let trough = window[0].price;
  for (const sample of window) {
    if (sample.price >= peak) {
      peak = sample.price;
      peakT = sample.t;
      trough = sample.price;
    } else {
      trough = Math.min(trough, sample.price);
      if (peak > 0) maxDd = Math.max(maxDd, ((peak - sample.price) / peak) * 100);
    }
  }
  const recovered = peak > 0 ? Math.max(0, ((lastPrice - trough) / peak) * 100) : 0;
  const elapsedMin = Math.max(0.05, (window[window.length - 1].t - peakT) / 60_000);
  return {
    maxRetracement: maxDd,
    retracementRatio: peak > 0 ? maxDd / Math.max(0.2, ((peak - window[0].price) / peak) * 100) : 0,
    recoverySpeed: recovered / elapsedMin,
  };
}

function computeExhaustion(input: {
  return5s: number;
  return1m: number;
  return5m: number;
  volumeAcceleration: number;
  rvol1m: number;
  retrace: { maxRetracement: number };
  velocity5s: number;
}) {
  let score = 0;
  if (input.return5s > 1.6 && input.return1m < input.return5s * 0.7) score += 25;
  if (input.return5m > 6 && input.volumeAcceleration < 0) score += 20;
  if (input.rvol1m < 0.9 && input.return1m > 1.2) score += 18;
  if (input.retrace.maxRetracement > 2.4 && input.return5m > 3) score += 16;
  if (input.velocity5s < 0 && input.return5m > 2) score += 22;
  if (input.return5s > 2.5) score += 12;
  return Math.min(100, score);
}
