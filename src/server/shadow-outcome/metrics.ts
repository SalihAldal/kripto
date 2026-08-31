import { OUTCOME_HORIZONS_MIN, REACH_THRESHOLDS, type HorizonOutcome, type OutcomeHorizonMin } from "@/src/server/shadow-outcome/types";

export type PricePoint = { t: number; price: number; high?: number; low?: number };

export function pctChange(from: number, to: number) {
  if (!from || from <= 0 || !Number.isFinite(to)) return null;
  return Number((((to - from) / from) * 100).toFixed(6));
}

export function computeHorizons(input: {
  detectedAt: number;
  detectionPrice: number;
  points: PricePoint[];
  now: number;
  gapMs: number;
  lookaheadSafe?: boolean;
}): HorizonOutcome[] {
  return OUTCOME_HORIZONS_MIN.map((horizonMin) =>
    computeOneHorizon({ ...input, horizonMin }),
  );
}

export function computeOneHorizon(input: {
  detectedAt: number;
  detectionPrice: number;
  points: PricePoint[];
  now: number;
  gapMs: number;
  horizonMin: OutcomeHorizonMin;
  lookaheadSafe?: boolean;
}): HorizonOutcome {
  const end = input.detectedAt + input.horizonMin * 60_000;
  const matured = input.now >= end;
  const window = input.points
    .filter((row) => {
      if (row.t < input.detectedAt) return false;
      if (row.t > end) return false;
      if (input.lookaheadSafe && row.t > input.now) return false;
      return true;
    })
    .sort((a, b) => a.t - b.t);
  if (!window.length) {
    const status = matured ? "HISTORY_UNAVAILABLE" : "PENDING";
    return {
      horizonMin: input.horizonMin,
      mfePct: null,
      maePct: null,
      returnPct: null,
      timeToMfeMs: null,
      complete: status !== "PENDING",
      quality: matured ? "HISTORY_UNAVAILABLE" : "OUTCOME_DATA_INCOMPLETE",
      status,
      invalidReason: matured ? "MARKET_HISTORY_MISSING" : null,
    };
  }
  let high = window[0].high ?? window[0].price;
  let low = window[0].low ?? window[0].price;
  let highAt = window[0].t;
  let prevT = window[0].t;
  let gapped = false;
  for (const row of window) {
    if (row.t - prevT > input.gapMs) gapped = true;
    prevT = row.t;
    const h = row.high ?? row.price;
    const l = row.low ?? row.price;
    if (h > high) {
      high = h;
      highAt = row.t;
    }
    if (l < low) low = l;
  }
  const last = window[window.length - 1];
  const complete = last.t >= end - 1_000 || matured;
  const quality = gapped ? "OUTCOME_DATA_INCOMPLETE" : "OK";
  if (quality === "OUTCOME_DATA_INCOMPLETE") {
    const status = complete ? "INVALID_DATA" : "PENDING";
    return {
      horizonMin: input.horizonMin,
      mfePct: null,
      maePct: null,
      returnPct: null,
      timeToMfeMs: null,
      complete: status !== "PENDING",
      quality,
      status,
      invalidReason: complete ? "MARKET_DATA_GAP" : null,
    };
  }
  return {
    horizonMin: input.horizonMin,
    mfePct: pctChange(input.detectionPrice, high),
    maePct: pctChange(input.detectionPrice, low),
    returnPct: pctChange(input.detectionPrice, last.price),
    timeToMfeMs: highAt - input.detectedAt,
    complete,
    quality,
    status: complete ? "COMPLETE" : "PENDING",
    invalidReason: null,
  };
}

export function computeReachTimes(input: {
  detectedAt: number;
  detectionPrice: number;
  points: PricePoint[];
  now: number;
  lookaheadSafe?: boolean;
}): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  for (const pct of REACH_THRESHOLDS) {
    result[`timeTo${pct}Percent`] = null;
    const target = input.detectionPrice * (1 + pct / 100);
    for (const row of input.points) {
      if (row.t < input.detectedAt) continue;
      if (input.lookaheadSafe && row.t > input.now) break;
      const h = row.high ?? row.price;
      if (h >= target) {
        result[`timeTo${pct}Percent`] = row.t - input.detectedAt;
        break;
      }
    }
  }
  return result;
}

export function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((q / 100) * sorted.length) - 1));
  return sorted[index];
}

export function proportionCI(successes: number, n: number, z = 1.96) {
  if (n < 10) return { n, rate: n ? successes / n : 0, label: "INSUFFICIENT_SAMPLE" as const, low: null, high: null };
  const p = successes / n;
  const se = Math.sqrt((p * (1 - p)) / n);
  return {
    n,
    rate: p,
    label: n < 20 ? ("INSUFFICIENT_SAMPLE" as const) : ("OK" as const),
    low: Math.max(0, p - z * se),
    high: Math.min(1, p + z * se),
  };
}

export function moveKey(symbol: string, detectedAt: number) {
  const bucket = Math.floor(detectedAt / (30 * 60_000));
  return `${symbol.toUpperCase()}:${bucket}`;
}
