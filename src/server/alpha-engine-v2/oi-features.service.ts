import type { ExternalSymbolPanel } from "./external-market-data.types";

export type OiFeatureSnapshot = {
  timestamp: number;
  oiLevel: number;
  oiDelta: number;
  oiDeltaPct: number;
  oiAcceleration: number;
  oiPercentile: number;
  oiZScore: number;
  priceReturn1h: number;
  priceReturn4h: number;
};

function percentileRank(values: number[], value: number) {
  if (!values.length) return 0.5;
  return values.filter((v) => v < value).length / values.length;
}

function zScore(values: number[], value: number) {
  if (values.length < 3) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  const std = Math.sqrt(variance);
  return std > 0 ? (value - mean) / std : 0;
}

function oiAtOrBefore(panel: ExternalSymbolPanel, time: number) {
  const oi = panel.openInterest;
  if (!oi.length) return null;
  let lo = 0;
  let hi = oi.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (oi[mid].timestamp <= time) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? oi[best] : null;
}

export function buildOiFeatures(panel: ExternalSymbolPanel, idx: number, lookbackHours = 4): OiFeatureSnapshot | null {
  const bar = panel.bars[idx];
  if (!bar || idx < lookbackHours + 24) return null;
  const nowOi = oiAtOrBefore(panel, bar.closeTime);
  const prevBar = panel.bars[idx - lookbackHours];
  const prevOi = prevBar ? oiAtOrBefore(panel, prevBar.closeTime) : null;
  if (!nowOi || !prevOi || prevOi.openInterest <= 0) return null;
  const oiDelta = nowOi.openInterest - prevOi.openInterest;
  const oiDeltaPct = (oiDelta / prevOi.openInterest) * 100;
  const priorBar = panel.bars[idx - lookbackHours * 2];
  const prior = priorBar ? oiAtOrBefore(panel, priorBar.closeTime) : null;
  const oiAcceleration = prior && prior.openInterest > 0
    ? oiDeltaPct - ((prevOi.openInterest - prior.openInterest) / prior.openInterest) * 100
    : 0;
  const deltas: number[] = [];
  for (let i = 24; i < idx; i += 4) {
    const b = panel.bars[i];
    const p = panel.bars[i - lookbackHours];
    if (!b || !p) continue;
    const oNow = oiAtOrBefore(panel, b.closeTime);
    const oPrev = oiAtOrBefore(panel, p.closeTime);
    if (oNow && oPrev && oPrev.openInterest > 0) deltas.push(((oNow.openInterest - oPrev.openInterest) / oPrev.openInterest) * 100);
  }
  const closes = panel.bars;
  const priceReturn1h = closes[idx - 1]?.close > 0 ? ((closes[idx].close - closes[idx - 1].close) / closes[idx - 1].close) * 100 : 0;
  const priceReturn4h = closes[idx - 4]?.close > 0 ? ((closes[idx].close - closes[idx - 4].close) / closes[idx - 4].close) * 100 : 0;
  return {
    timestamp: bar.closeTime,
    oiLevel: nowOi.openInterest,
    oiDelta,
    oiDeltaPct,
    oiAcceleration,
    oiPercentile: percentileRank(deltas, oiDeltaPct),
    oiZScore: zScore(deltas, oiDeltaPct),
    priceReturn1h,
    priceReturn4h,
  };
}

export type OiStateQuadrant = "PRICE_UP_OI_UP" | "PRICE_UP_OI_DOWN" | "PRICE_DOWN_OI_UP" | "PRICE_DOWN_OI_DOWN";

export function classifyOiState(priceReturn4h: number, oiDeltaPct: number): OiStateQuadrant | null {
  if (Math.abs(priceReturn4h) < 0.05 || Math.abs(oiDeltaPct) < 0.05) return null;
  if (priceReturn4h > 0 && oiDeltaPct > 0) return "PRICE_UP_OI_UP";
  if (priceReturn4h > 0 && oiDeltaPct <= 0) return "PRICE_UP_OI_DOWN";
  if (priceReturn4h <= 0 && oiDeltaPct > 0) return "PRICE_DOWN_OI_UP";
  return "PRICE_DOWN_OI_DOWN";
}

export function buildOiStateMatrix(panel: ExternalSymbolPanel, holdHours = 8) {
  const buckets = new Map<OiStateQuadrant, { longExp: number[]; shortExp: number[]; mfe: number[]; mae: number[] }>();
  for (let idx = 48; idx < panel.bars.length - holdHours; idx += 4) {
    const feat = buildOiFeatures(panel, idx);
    if (!feat) continue;
    const state = classifyOiState(feat.priceReturn4h, feat.oiDeltaPct);
    if (!state) continue;
    const entry = panel.bars[idx].close;
    const exit = panel.bars[idx + holdHours].close;
    const high = panel.bars.slice(idx, idx + holdHours + 1).reduce((m, b) => Math.max(m, b.high), entry);
    const low = panel.bars.slice(idx, idx + holdHours + 1).reduce((m, b) => Math.min(m, b.low), entry);
    const longRet = ((exit - entry) / entry) * 100;
    const shortRet = ((entry - exit) / entry) * 100;
    const row = buckets.get(state) ?? { longExp: [], shortExp: [], mfe: [], mae: [] };
    row.longExp.push(longRet);
    row.shortExp.push(shortRet);
    row.mfe.push(((high - entry) / entry) * 100);
    row.mae.push(((low - entry) / entry) * 100);
    buckets.set(state, row);
  }
  return [...buckets.entries()].map(([state, v]) => ({
    state,
    samples: v.longExp.length,
    longExpectancy: v.longExp.reduce((s, x) => s + x, 0) / v.longExp.length,
    shortExpectancy: v.shortExp.reduce((s, x) => s + x, 0) / v.shortExp.length,
    avgMfe: v.mfe.reduce((s, x) => s + x, 0) / v.mfe.length,
    avgMae: v.mae.reduce((s, x) => s + x, 0) / v.mae.length,
  }));
}
