import type { MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { BookTickerState } from "@/src/server/market-data/spine/events";
import {
  PR02_POLICY_VERSION,
  PR02_SCHEMA_VERSION,
  type EarlyFeatureQuality,
  type EarlyFeatureSet,
  type EarlyFeatureSpec,
} from "@/src/server/profitability/pr02-types";

const WINDOWS_MS = { s5: 5_000, s15: 15_000, s30: 30_000, s60: 60_000 } as const;
const MIN_TRADES_FOR_FLOW = 3;
const MIN_HISTORY_MS = 15_000;
const STALE_BOOK_MS = 30_000;

function inWindow(trades: MarketTradeEvent[], now: number, ms: number) {
  const cutoff = now - ms;
  return trades.filter((row) => (row.tradeTime || row.eventTime || row.receiveTime) >= cutoff);
}

function flowStats(trades: MarketTradeEvent[]) {
  let buy = 0;
  let sell = 0;
  for (const row of trades) {
    if (row.takerSide === "BUY") buy += row.quoteNotional;
    else sell += row.quoteNotional;
  }
  const total = buy + sell;
  return { buy, sell, total, imbalance: total > 0 ? (buy - sell) / total : 0 };
}

function tradeRate(count: number, seconds: number) {
  if (seconds <= 0) return 0;
  return count / seconds;
}

function safeRatio(numerator: number, denominator: number, minDenominator = 1e-6): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (Math.abs(denominator) < minDenominator) return null;
  const value = numerator / denominator;
  if (!Number.isFinite(value)) return null;
  return value;
}

function spec(
  key: string,
  value: number | null,
  unit: string,
  windowMs: number | null,
  baseline: string | null,
  availableAt: string,
  quality: EarlyFeatureQuality,
  reasonCode: string | null,
): EarlyFeatureSpec {
  return {
    key,
    value: value == null ? null : Number(value.toFixed(6)),
    unit,
    windowMs,
    baseline,
    availableAt,
    quality,
    reasonCode,
    transformVersion: "pr02-v1",
  };
}

function shortReturnPct(trades: MarketTradeEvent[], now: number): { value: number | null; quality: EarlyFeatureQuality } {
  const window = inWindow(trades, now, WINDOWS_MS.s5);
  if (window.length < 2) return { value: null, quality: "INSUFFICIENT_DATA" };
  const first = window[0]!.price;
  const last = window[window.length - 1]!.price;
  if (first <= 0) return { value: null, quality: "INVALID" };
  return { value: ((last - first) / first) * 100, quality: "VALID" };
}

function priceAcceleration(trades: MarketTradeEvent[], now: number): { value: number | null; quality: EarlyFeatureQuality } {
  const recent = inWindow(trades, now, WINDOWS_MS.s5);
  const baseline = inWindow(trades, now, WINDOWS_MS.s15).filter(
    (row) => (row.tradeTime || row.eventTime || row.receiveTime) < now - WINDOWS_MS.s5,
  );
  if (recent.length < 2) return { value: null, quality: "INSUFFICIENT_DATA" };
  const recentFirst = recent[0]!.price;
  const recentLast = recent[recent.length - 1]!.price;
  if (recentFirst <= 0) return { value: null, quality: "INVALID" };
  const recentReturn = ((recentLast - recentFirst) / recentFirst) * 100;
  if (baseline.length < 2) {
    return { value: recentReturn, quality: "VALID" };
  }
  const baseFirst = baseline[0]!.price;
  const baseLast = baseline[baseline.length - 1]!.price;
  if (baseFirst <= 0) return { value: recentReturn, quality: "VALID" };
  const baseReturn = ((baseLast - baseFirst) / baseFirst) * 100;
  return { value: recentReturn - baseReturn, quality: "VALID" };
}

function flowContinuity(trades: MarketTradeEvent[], now: number): { value: number | null; quality: EarlyFeatureQuality } {
  const slices = [WINDOWS_MS.s5, WINDOWS_MS.s15].map((ms) => flowStats(inWindow(trades, now, ms)).imbalance);
  if (slices.some((v) => !Number.isFinite(v))) return { value: null, quality: "INSUFFICIENT_DATA" };
  const positive = slices.filter((v) => v > 0.05).length;
  const negative = slices.filter((v) => v < -0.05).length;
  if (positive >= 2) return { value: 1, quality: "VALID" };
  if (negative >= 2) return { value: -1, quality: "VALID" };
  return { value: 0, quality: "VALID" };
}

export function computeEarlyFeatures(input: {
  symbol: string;
  candidateId: string;
  lifecycleId: string;
  marketEventAt: string;
  observedAt: string;
  nowMs: number;
  trades: MarketTradeEvent[];
  book: BookTickerState | null;
  baselinePrice: number;
  firstDetectionPrice: number;
  intendedNotional: number;
  fallback?: {
    velocity?: number | null;
    acceleration?: number | null;
    volumeAcceleration?: number | null;
    relativeStrength?: number | null;
    flowImbalance?: number | null;
    tradeRateAcceleration?: number | null;
    spreadBps?: number | null;
    liquidityScore?: number | null;
    staleFeatures?: string[];
    missingFeatures?: string[];
    invalidFeatures?: string[];
  };
}): EarlyFeatureSet {
  const now = input.nowMs;
  const trades = input.trades;
  const t5 = inWindow(trades, now, WINDOWS_MS.s5);
  const t15 = inWindow(trades, now, WINDOWS_MS.s15);
  const t60 = inWindow(trades, now, WINDOWS_MS.s60);
  const f5 = flowStats(t5);
  const f15 = flowStats(t15);
  const f60 = flowStats(t60);
  const producerTradeMode = trades.length > 0;
  const historyMs = trades.length ? now - Math.min(...trades.map((r) => r.tradeTime || r.eventTime || r.receiveTime)) : 0;
  const warmupComplete = producerTradeMode
    ? historyMs >= MIN_HISTORY_MS && t15.length >= MIN_TRADES_FOR_FLOW
    : Boolean(
        input.fallback?.velocity != null &&
          input.fallback?.acceleration != null &&
          input.fallback?.flowImbalance != null,
      );
  const bookFresh = input.book ? now - (input.book.lastUpdateAt || input.book.eventTime || 0) <= STALE_BOOK_MS : false;

  const shortRet = producerTradeMode
    ? shortReturnPct(trades, now)
    : {
        value: input.fallback?.velocity != null ? input.fallback.velocity * 0.12 : null,
        quality: input.fallback?.velocity != null ? ("VALID" as EarlyFeatureQuality) : ("MISSING" as EarlyFeatureQuality),
      };
  const accel = producerTradeMode
    ? priceAcceleration(trades, now)
    : {
        value: input.fallback?.acceleration ?? null,
        quality: input.fallback?.acceleration != null ? ("VALID" as EarlyFeatureQuality) : ("MISSING" as EarlyFeatureQuality),
      };
  const extensionPct = input.baselinePrice > 0
    ? ((input.trades[input.trades.length - 1]?.price ?? input.baselinePrice) - input.baselinePrice) / input.baselinePrice * 100
    : null;

  const tradeRate5s = producerTradeMode ? tradeRate(t5.length, 5) : input.fallback?.velocity ?? 0;
  const tradeRate15s = producerTradeMode ? tradeRate(t15.length, 15) : input.fallback?.velocity ?? 0;
  const tradeRate60s = producerTradeMode ? tradeRate(t60.length, 60) : input.fallback?.velocity ?? 0;
  const baselineTradeRate = Math.max(tradeRate60s, tradeRate15s * 0.5, 0.01);
  const relativeActivity = trades.length
    ? safeRatio(tradeRate5s, baselineTradeRate, 0.01)
    : null;
  const tradeRateAcceleration = trades.length >= MIN_TRADES_FOR_FLOW
    ? tradeRate5s - tradeRate15s
    : input.fallback?.tradeRateAcceleration ?? null;

  const volumeBaseline = Math.max(1, f60.total / Math.max(1, t60.length / 5));
  const volumeAccelerationRatio = safeRatio(f5.total - volumeBaseline, volumeBaseline, 1);

  const flowImbalance5s = producerTradeMode && t5.length >= MIN_TRADES_FOR_FLOW
    ? f5.imbalance
    : input.fallback?.flowImbalance ?? null;
  const buyFlowAcceleration = safeRatio(f5.buy / 5 - f15.buy / 15, Math.max(f15.buy / 15, 1), 1);
  const continuity = trades.length >= MIN_TRADES_FOR_FLOW ? flowContinuity(trades, now) : { value: null, quality: "INSUFFICIENT_DATA" as EarlyFeatureQuality };

  const spreadBps = producerTradeMode && input.book && input.book.bestBid > 0 && input.book.bestAsk > 0
    ? ((input.book.bestAsk - input.book.bestBid) / ((input.book.bestBid + input.book.bestAsk) / 2)) * 10_000
    : input.fallback?.spreadBps ?? null;
  const depthCoverage = producerTradeMode && input.book && input.book.bestBidQty > 0 && input.book.bestAskQty > 0
    ? Math.min(1, ((input.book.bestBid * input.book.bestBidQty) + (input.book.bestAsk * input.book.bestAskQty)) / Math.max(input.intendedNotional, 1))
    : input.fallback?.liquidityScore ?? null;

  const availableAt = input.observedAt;
  const features: Record<string, EarlyFeatureSpec> = {
    priceReturnShortPct: spec("priceReturnShortPct", shortRet.value, "percent", WINDOWS_MS.s5, "prior_5s_window", availableAt, shortRet.quality, shortRet.quality !== "VALID" ? "PRICE_RETURN_SHORT_" + shortRet.quality : null),
    priceAcceleration: spec("priceAcceleration", accel.value, "percent_delta", WINDOWS_MS.s5, "prior_5s_return", availableAt, accel.quality, accel.quality !== "VALID" ? "PRICE_ACCEL_" + accel.quality : null),
    extensionFromBaselinePct: spec("extensionFromBaselinePct", extensionPct, "percent", null, "recent_baseline_price", availableAt, extensionPct == null ? "MISSING" : "VALID", extensionPct == null ? "BASELINE_PRICE_MISSING" : null),
    tradeRate5s: spec("tradeRate5s", tradeRate5s, "trades_per_sec", WINDOWS_MS.s5, null, availableAt, producerTradeMode ? (t5.length ? "VALID" : "INSUFFICIENT_DATA") : input.fallback?.velocity != null ? "VALID" : "MISSING", t5.length ? null : "TRADE_COUNT_LOW"),
    tradeRateAcceleration: spec("tradeRateAcceleration", tradeRateAcceleration, "trades_per_sec_delta", WINDOWS_MS.s5, "trade_rate_15s", availableAt, tradeRateAcceleration != null ? "VALID" : "INSUFFICIENT_DATA", null),
    relativeActivity: spec("relativeActivity", relativeActivity, "ratio", WINDOWS_MS.s5, "trade_rate_60s", availableAt, trades.length ? (relativeActivity == null ? "INSUFFICIENT_DATA" : "VALID") : "INSUFFICIENT_DATA", relativeActivity == null ? "ZERO_BASELINE_TRADE_RATE" : null),
    volumeAcceleration: spec("volumeAcceleration", volumeAccelerationRatio ?? input.fallback?.volumeAcceleration ?? null, "ratio", WINDOWS_MS.s5, "volume_baseline_60s", availableAt, volumeAccelerationRatio != null || input.fallback?.volumeAcceleration != null ? "VALID" : "INSUFFICIENT_DATA", null),
    flowImbalance5s: spec("flowImbalance5s", flowImbalance5s, "signed_ratio", WINDOWS_MS.s5, null, availableAt, flowImbalance5s != null ? "VALID" : producerTradeMode ? "INSUFFICIENT_DATA" : "MISSING", flowImbalance5s == null ? "FLOW_SAMPLE_LOW" : null),
    buyFlowAcceleration: spec("buyFlowAcceleration", buyFlowAcceleration, "quote_per_sec_delta", WINDOWS_MS.s5, "buy_rate_15s", availableAt, buyFlowAcceleration != null ? "VALID" : "INSUFFICIENT_DATA", null),
    flowContinuity: spec("flowContinuity", continuity.value, "signed_score", WINDOWS_MS.s15, null, availableAt, continuity.quality, continuity.quality !== "VALID" ? "FLOW_CONTINUITY_" + continuity.quality : null),
    spreadBps: spec("spreadBps", spreadBps, "basis_points", null, null, availableAt, spreadBps == null ? "MISSING" : spreadBps < 0 ? "INVALID" : producerTradeMode ? (bookFresh ? "VALID" : "STALE") : "VALID", spreadBps == null ? "SPREAD_MISSING" : producerTradeMode && !bookFresh ? "BOOK_STALE" : null),
    depthCoverage: spec("depthCoverage", depthCoverage, "ratio_0_1", null, "intended_notional", availableAt, depthCoverage == null ? "MISSING" : "VALID", depthCoverage == null ? "DEPTH_MISSING" : null),
    relativeStrength: spec("relativeStrength", input.fallback?.relativeStrength ?? null, "ratio", null, "benchmark_optional", availableAt, input.fallback?.relativeStrength != null ? "VALID" : "MISSING", input.fallback?.relativeStrength == null ? "BENCHMARK_RELATIVE_STRENGTH_OPTIONAL_MISSING" : null),
  };

  const required = ["priceReturnShortPct", "priceAcceleration", "tradeRate5s", "flowImbalance5s", "spreadBps", "depthCoverage"];
  const optional = ["relativeStrength"];
  const missingRequired = required.filter((key) => {
    const quality = features[key]?.quality;
    return quality === "MISSING" || quality === "INVALID";
  });
  const missingOptional = optional.filter((key) => features[key]?.quality === "MISSING");
  const invalidFeatures = Object.values(features).filter((f) => f.quality === "INVALID").map((f) => f.key);
  const staleFeatures = [
    ...(input.fallback?.staleFeatures ?? []),
    ...Object.values(features).filter((f) => f.quality === "STALE").map((f) => f.key),
  ];

  return {
    schemaVersion: PR02_SCHEMA_VERSION,
    policyVersion: PR02_POLICY_VERSION,
    symbol: input.symbol,
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    marketEventAt: input.marketEventAt,
    observedAt: input.observedAt,
    coverage: {
      tradeCount: trades.length,
      historyMs,
      bookFresh,
      warmupComplete,
    },
    features,
    missingRequired,
    missingOptional,
    invalidFeatures,
    staleFeatures,
  };
}
