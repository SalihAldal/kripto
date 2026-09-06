import type { MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { BookTickerState } from "@/src/server/market-data/spine/events";
import {
  PR03_POLICY_VERSION,
  type CausalCandle,
  type FeatureQuality,
  type ReferenceLevel,
  type StrategyContextExtension,
} from "@/src/server/profitability/pr03-types";

export const BREAKOUT_LEVEL_LOOKBACK_MS = 300_000;
export const PIVOT_CONFIRMATION_BARS = 2;
export const BREAKOUT_TOLERANCE_BPS = 12;
export const RETEST_TOLERANCE_BPS = 25;
export const HOLD_INVALIDATION_BPS = 45;
export const MOMENTUM_IMPULSE_MIN_PCT = 0.45;
export const MOMENTUM_PAUSE_MAX_RETRACE_PCT = 0.38;
export const MOMENTUM_MAX_EXTENSION_PCT = 3.2;
export const MIN_CLOSED_CANDLES = 6;

function closedCandles(candles: CausalCandle[], asOfMs: number) {
  return candles.filter((c) => c.closed && c.availableAt <= asOfMs && c.closeTime <= asOfMs);
}

function flowImbalance(trades: MarketTradeEvent[]) {
  let buy = 0;
  let sell = 0;
  for (const row of trades) {
    if (row.takerSide === "BUY") buy += row.quoteNotional;
    else sell += row.quoteNotional;
  }
  const total = buy + sell;
  return total > 0 ? (buy - sell) / total : 0;
}

export function computeConfirmedPivotLevel(candles: CausalCandle[], asOfMs: number): ReferenceLevel {
  const closed = closedCandles(candles, asOfMs);
  if (closed.length < MIN_CLOSED_CANDLES) {
    return {
      level: null,
      levelVersion: "pivot-v1",
      source: "CONFIRMED_PIVOT_HIGH",
      pivotAtMs: 0,
      availableAtMs: asOfMs,
      windowMs: BREAKOUT_LEVEL_LOOKBACK_MS,
      toleranceBps: BREAKOUT_TOLERANCE_BPS,
      quality: "INSUFFICIENT_DATA",
      reasonCode: "INSUFFICIENT_CLOSED_CANDLES",
    };
  }
  const windowStart = asOfMs - BREAKOUT_LEVEL_LOOKBACK_MS;
  const inWindow = closed.filter((c) => c.closeTime >= windowStart);
  let best: { level: number; pivotAtMs: number; availableAtMs: number } | null = null;
  for (let i = PIVOT_CONFIRMATION_BARS; i < inWindow.length - PIVOT_CONFIRMATION_BARS; i++) {
    const pivot = inWindow[i]!;
    const confirm = inWindow[i + PIVOT_CONFIRMATION_BARS];
    if (!confirm || confirm.availableAt > asOfMs) continue;
    const slice = inWindow.slice(i - PIVOT_CONFIRMATION_BARS, i + PIVOT_CONFIRMATION_BARS + 1);
    const isHigh = slice.every((c, idx) => idx === PIVOT_CONFIRMATION_BARS || c.high <= pivot.high);
    if (!isHigh) continue;
    if (!best || pivot.high > best.level) {
      best = { level: pivot.high, pivotAtMs: pivot.closeTime, availableAtMs: confirm.availableAt };
    }
  }
  if (!best) {
    return {
      level: null,
      levelVersion: "pivot-v1",
      source: "CONFIRMED_PIVOT_HIGH",
      pivotAtMs: 0,
      availableAtMs: asOfMs,
      windowMs: BREAKOUT_LEVEL_LOOKBACK_MS,
      toleranceBps: BREAKOUT_TOLERANCE_BPS,
      quality: "INSUFFICIENT_DATA",
      reasonCode: "NO_CONFIRMED_PIVOT",
    };
  }
  return {
    level: Number(best.level.toFixed(8)),
    levelVersion: "pivot-v1",
    source: "CONFIRMED_PIVOT_HIGH",
    pivotAtMs: best.pivotAtMs,
    availableAtMs: best.availableAtMs,
    windowMs: BREAKOUT_LEVEL_LOOKBACK_MS,
    toleranceBps: BREAKOUT_TOLERANCE_BPS,
    quality: "VALID",
    reasonCode: null,
  };
}

export function detectBreakoutOnClosedCandle(level: number, candles: CausalCandle[], asOfMs: number) {
  const closed = closedCandles(candles, asOfMs);
  const latest = closed[closed.length - 1];
  if (!latest) return { confirmed: false, reasonCode: "NO_CLOSED_CANDLE" };
  const threshold = level * (1 + BREAKOUT_TOLERANCE_BPS / 10_000);
  if (latest.close > threshold) return { confirmed: true, atMs: latest.closeTime, reasonCode: "BREAKOUT_CLOSE_ABOVE_LEVEL" };
  return { confirmed: false, reasonCode: "NO_BREAKOUT_CLOSE" };
}

export function findFirstBreakoutAfterLevel(level: number, candles: CausalCandle[], asOfMs: number, afterMs = 0) {
  const closed = closedCandles(candles, asOfMs).filter((c) => c.closeTime >= afterMs);
  const threshold = level * (1 + BREAKOUT_TOLERANCE_BPS / 10_000);
  for (const c of closed) {
    if (c.close > threshold) return { confirmed: true, atMs: c.closeTime, reasonCode: "BREAKOUT_CLOSE_ABOVE_LEVEL" };
  }
  return { confirmed: false, reasonCode: "NO_BREAKOUT_CLOSE" };
}

export function detectRetest(level: number, candles: CausalCandle[], asOfMs: number, sinceMs: number) {
  const closed = closedCandles(candles, asOfMs).filter((c) => c.closeTime > sinceMs);
  const bandLow = level * (1 - RETEST_TOLERANCE_BPS / 10_000);
  const bandHigh = level * (1 + RETEST_TOLERANCE_BPS / 10_000);
  const invalidation = level * (1 - HOLD_INVALIDATION_BPS / 10_000);
  for (const c of closed) {
    if (c.low < invalidation) return { observed: false, invalidated: true, atMs: null, reasonCode: "RETEST_FAILED_HOLD" };
    if (c.low <= bandHigh && c.low >= bandLow) return { observed: true, invalidated: false, atMs: c.closeTime, reasonCode: "RETEST_IN_BAND" };
  }
  return { observed: false, invalidated: false, atMs: null, reasonCode: "RETEST_NOT_OBSERVED" };
}

export function detectHoldAboveLevel(level: number, candles: CausalCandle[], asOfMs: number, sinceMs: number) {
  const closed = closedCandles(candles, asOfMs).filter((c) => c.closeTime > sinceMs);
  if (!closed.length) return { held: false, reasonCode: "NO_POST_RETEST_CANDLES" };
  const invalidation = level * (1 - HOLD_INVALIDATION_BPS / 10_000);
  const minHoldClose = level * (1 + BREAKOUT_TOLERANCE_BPS / 10_000);
  const allHeld = closed.every((c) => c.close >= invalidation && c.close >= minHoldClose);
  return {
    held: allHeld && closed.length >= 2,
    reasonCode: allHeld ? "HOLD_ABOVE_LEVEL" : "HOLD_FAILED",
  };
}

export function computeFlowFromTrades(trades: MarketTradeEvent[], asOfMs: number, windowMs = 15_000) {
  const rows = trades.filter((t) => (t.tradeTime || t.eventTime || t.receiveTime) <= asOfMs && (t.tradeTime || t.eventTime || t.receiveTime) >= asOfMs - windowMs);
  if (rows.length < 3) return { quality: "INSUFFICIENT_DATA" as FeatureQuality, value: null, reasonCode: "FLOW_SAMPLE_LOW" };
  return { quality: "VALID" as FeatureQuality, value: flowImbalance(rows), reasonCode: null };
}

export function computeImpulseMetrics(candles: CausalCandle[], asOfMs: number) {
  const closed = closedCandles(candles, asOfMs);
  if (closed.length < 4) return { quality: "INSUFFICIENT_DATA" as FeatureQuality, impulsePct: null, pauseRetracePct: null, extensionPct: null };
  const start = closed[0]!;
  const peak = closed.reduce((max, c) => (c.high > max.high ? c : max), closed[0]!);
  const latest = closed[closed.length - 1]!;
  const impulsePct = start.open > 0 ? ((peak.high - start.open) / start.open) * 100 : null;
  const pauseRetracePct = peak.high > 0 ? ((peak.high - latest.close) / peak.high) * 100 : null;
  const extensionPct = start.open > 0 ? ((latest.close - start.open) / start.open) * 100 : null;
  return { quality: "VALID" as FeatureQuality, impulsePct, pauseRetracePct, extensionPct, peakPrice: peak.high, impulseStartPrice: start.open };
}

export function isBookFresh(book: BookTickerState | null | undefined, asOfMs: number, staleMs = 30_000) {
  if (!book) return false;
  return asOfMs - (book.lastUpdateAt || book.eventTime || 0) <= staleMs;
}

export function resolveStrategyContext(ctx: StrategyContextExtension | undefined, input: { candidateId: string }) {
  return {
    trades: ctx?.trades ?? [],
    candles: ctx?.candles ?? [],
    book: ctx?.book ?? null,
    nowMs: ctx?.nowMs ?? Date.now(),
    lifecycleId: ctx?.lifecycleId ?? input.candidateId,
    featureSnapshotId: ctx?.featureSnapshotId ?? null,
    tickSize: ctx?.tickSize ?? 0.01,
  };
}

export { PR03_POLICY_VERSION };
