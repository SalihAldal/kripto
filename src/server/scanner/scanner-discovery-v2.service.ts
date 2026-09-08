import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";

/** Setup-aware discovery families — evidence-derived, not brute-tuned. */
export const DISCOVERY_V2_SETUP_FAMILIES = [
  "VOLUME_CONFIRMED_MOMENTUM",
  "BREAKOUT_CONTINUATION",
  "TREND_PULLBACK",
  "VOLATILITY_EXPANSION",
] as const;

export type DiscoveryV2SetupFamily = (typeof DISCOVERY_V2_SETUP_FAMILIES)[number];

export type QualityClass =
  | "STRONG_POSITIVE_EDGE"
  | "WEAK_POSITIVE_EDGE"
  | "NO_EDGE"
  | "NEGATIVE_EDGE";

export type MarketStateFeatures = {
  symbol: string;
  timestamp: number;
  quoteAsset: string;
  return1m: number;
  return3m: number;
  return5m: number;
  return15m: number;
  return30m: number;
  return60m: number;
  volumeRatio5: number;
  volumeRatio20: number;
  volumeRatio60: number;
  volumeAcceleration: number;
  volumePersistence: number;
  priceVolumeConfirmation: number;
  atrPercent: number;
  realizedVolatility: number;
  rsi14: number;
  trendStrength: number;
  distanceFrom20mHigh: number;
  distanceFrom60mHigh: number;
  distanceFrom20mLow: number;
  distanceFrom60mLow: number;
  extensionFrom60mLow: number;
  spreadPercent: number;
  liquidity24h: number;
  btcReturn5m: number;
  btcReturn15m: number;
  symbolRegime: string;
  microScore: number;
  scannerScore: number;
};

export type SetupEvaluation = {
  family: DiscoveryV2SetupFamily;
  setupConfidence: number;
  tier: "LOW" | "MEDIUM" | "HIGH" | "ELITE";
  reasons: string[];
  invalidating: string[];
};

export type DiscoveryV2Candidate = {
  symbol: string;
  setup: SetupEvaluation;
  features: MarketStateFeatures;
  context: MarketContext;
};

export const DISCOVERY_V2_POLICY = {
  /** Realistic round-trip cost for opportunity labeling (fee + expected slippage). */
  realisticRoundTripCostPct: 0.44,
  strongPositiveEdgeMinNetPct: 1.5,
  weakPositiveEdgeMinNetPct: 0.44,
  shortlistMinConfidence: 42,
  maxShortlistPerWindow: 3,
  nearHighInvalidatePct: 0.35,
  overextensionPenaltyStartPct: 5.5,
  volumeSweetMin: 0.85,
  volumeSweetMax: 1.85,
} as const;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function returnAt(closes: number[], lookback: number) {
  const latest = closes.at(-1) ?? 0;
  const past = closes.at(-1 - lookback) ?? closes[0] ?? latest;
  if (past <= 0) return 0;
  return ((latest - past) / past) * 100;
}

function volRatio(volumes: number[], lookback: number) {
  const recent = volumes.slice(-Math.min(5, lookback));
  const base = volumes.slice(-lookback - 1, -1);
  const r = recent.reduce((s, v) => s + v, 0) / Math.max(1, recent.length);
  const b = base.reduce((s, v) => s + v, 0) / Math.max(1, base.length);
  return b > 0 ? r / b : 1;
}

function confidenceTier(score: number): SetupEvaluation["tier"] {
  if (score >= 72) return "ELITE";
  if (score >= 58) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

export function extractMarketStateFeatures(input: {
  context: MarketContext;
  klines: KlineItem[];
  idx: number;
  btcKlines?: KlineItem[];
  btcIdx?: number;
}): MarketStateFeatures {
  const { context, klines, idx } = input;
  const window = klines.slice(Math.max(0, idx - 120), idx + 1);
  const closes = window.map((r) => r.close);
  const volumes = window.map((r) => r.volume);
  const price = closes.at(-1) ?? context.lastPrice;
  const high20 = Math.max(...window.slice(-20).map((r) => r.high));
  const low20 = Math.min(...window.slice(-20).map((r) => r.low));
  const shortMom = Number(context.metadata.shortMomentumPercent ?? 0);
  const hourMom = Number(context.metadata.hourMomentumPercent ?? 0);
  const vol5 = volRatio(volumes, 5);
  const vol20 = Number(context.metadata.volumeRatio20 ?? volRatio(volumes, 20));
  const vol60 = volRatio(volumes, 60);
  const volAccel = vol5 - vol20;
  const volPersist = vol20 > 0 ? vol5 / vol20 : 1;
  const pvConfirm = shortMom > 0 && vol20 >= 1 ? clamp(shortMom * vol20 * 10, 0, 100) : 0;

  let btcReturn5m = 0;
  let btcReturn15m = 0;
  if (input.btcKlines && input.btcIdx !== undefined && input.btcIdx >= 5) {
    const btcCloses = input.btcKlines.slice(0, input.btcIdx + 1).map((r) => r.close);
    btcReturn5m = returnAt(btcCloses, 5);
    btcReturn15m = returnAt(btcCloses, 15);
  }

  const score = scoreContext(context);
  const microScore = (score.metrics.microMomentum + score.metrics.microFlow + score.metrics.orderBook) / 3;

  return {
    symbol: context.symbol,
    timestamp: klines[idx]?.closeTime ?? 0,
    quoteAsset: context.symbol.endsWith("TRY") ? "TRY" : context.symbol.endsWith("USDT") ? "USDT" : "OTHER",
    return1m: returnAt(closes, 1),
    return3m: returnAt(closes, 3),
    return5m: shortMom * 0.85,
    return15m: shortMom * 2.2,
    return30m: hourMom * 0.55,
    return60m: hourMom,
    volumeRatio5: Number(vol5.toFixed(4)),
    volumeRatio20: Number(vol20.toFixed(4)),
    volumeRatio60: Number(vol60.toFixed(4)),
    volumeAcceleration: Number(volAccel.toFixed(4)),
    volumePersistence: Number(volPersist.toFixed(4)),
    priceVolumeConfirmation: Number(pvConfirm.toFixed(2)),
    atrPercent: Number(context.metadata.atrPercent ?? context.volatilityPercent),
    realizedVolatility: context.volatilityPercent,
    rsi14: Number(context.metadata.rsi14 ?? 50),
    trendStrength: shortMom > 0 && hourMom > 0 ? clamp((shortMom + hourMom) * 8, 0, 100) : 0,
    distanceFrom20mHigh: high20 > 0 ? ((high20 - price) / high20) * 100 : 0,
    distanceFrom60mHigh: Number(context.metadata.distanceFrom60mHighPercent ?? 0),
    distanceFrom20mLow: low20 > 0 ? ((price - low20) / low20) * 100 : 0,
    distanceFrom60mLow: Number(context.metadata.extensionFrom60mLowPercent ?? 0),
    extensionFrom60mLow: Number(context.metadata.extensionFrom60mLowPercent ?? 0),
    spreadPercent: context.spreadPercent,
    liquidity24h: context.volume24h,
    btcReturn5m,
    btcReturn15m,
    symbolRegime: String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS"),
    microScore: Number(microScore.toFixed(2)),
    scannerScore: score.score,
  };
}

function evaluateVolumeConfirmedMomentum(f: MarketStateFeatures, ctx: MarketContext): SetupEvaluation | null {
  const invalidating: string[] = [];
  if (f.spreadPercent > 0.14) invalidating.push("spread_too_wide");
  if (f.distanceFrom60mHigh < DISCOVERY_V2_POLICY.nearHighInvalidatePct) invalidating.push("at_60m_high");
  if (ctx.fakeSpikeScore > 1.6) invalidating.push("fake_spike");
  if (f.volumeRatio20 < DISCOVERY_V2_POLICY.volumeSweetMin || f.volumeRatio20 > DISCOVERY_V2_POLICY.volumeSweetMax) {
    invalidating.push("volume_outside_sweet_band");
  }
  if (f.return5m < 0.04 || f.return15m < 0.08) invalidating.push("insufficient_momentum");
  if (f.return60m < 0) invalidating.push("hour_trend_negative");
  if (invalidating.length) return null;

  let conf = 40;
  conf += clamp((f.volumeRatio20 - 0.9) * 25, 0, 18);
  conf += clamp(f.return15m * 8, 0, 16);
  conf += clamp(f.priceVolumeConfirmation * 0.15, 0, 12);
  conf += f.btcReturn15m >= 0 ? 6 : -8;
  conf -= f.extensionFrom60mLow > DISCOVERY_V2_POLICY.overextensionPenaltyStartPct ? 12 : 0;
  conf = clamp(conf, 0, 95);
  return {
    family: "VOLUME_CONFIRMED_MOMENTUM",
    setupConfidence: Number(conf.toFixed(2)),
    tier: confidenceTier(conf),
    reasons: ["sustained_volume", "momentum_alignment", "pv_confirmation"],
    invalidating: [],
  };
}

function evaluateBreakoutContinuation(f: MarketStateFeatures, ctx: MarketContext): SetupEvaluation | null {
  const invalidating: string[] = [];
  if (f.extensionFrom60mLow < 0.8 || f.extensionFrom60mLow > 5.5) invalidating.push("extension_out_of_band");
  if (f.volumeRatio20 < 0.88) invalidating.push("weak_volume");
  if (f.return5m < 0.05 || f.return15m < 0.1) invalidating.push("no_breakout_momentum");
  if (f.distanceFrom60mHigh < 0.5) invalidating.push("already_at_high");
  if (invalidating.length) return null;

  let conf = 38;
  conf += clamp(f.extensionFrom60mLow * 4, 0, 16);
  conf += clamp((f.volumeRatio20 - 0.85) * 20, 0, 14);
  conf += clamp(f.trendStrength * 0.12, 0, 12);
  conf += f.volumeAcceleration > 0.1 ? 8 : 0;
  conf -= ctx.pumpRisk > 60 ? 10 : 0;
  conf = clamp(conf, 0, 92);
  return {
    family: "BREAKOUT_CONTINUATION",
    setupConfidence: Number(conf.toFixed(2)),
    tier: confidenceTier(conf),
    reasons: ["extension_breakout", "volume_follow_through"],
    invalidating: [],
  };
}

function evaluateTrendPullback(f: MarketStateFeatures): SetupEvaluation | null {
  if (f.return60m < 0.12) return null;
  if (f.return5m < 0.02 || f.return5m > 0.14) return null;
  if (f.return15m < 0.04 || f.return15m > 0.35) return null;
  if (f.volumeRatio20 < 0.72) return null;
  if (f.rsi14 > 76) return null;

  let conf = 36;
  conf += clamp(f.return60m * 6, 0, 18);
  conf += clamp(f.volumeRatio20 * 12, 0, 14);
  conf += f.return5m > 0.04 && f.return5m < 0.1 ? 10 : 0;
  conf += f.btcReturn15m >= 0 ? 5 : -6;
  conf = clamp(conf, 0, 88);
  return {
    family: "TREND_PULLBACK",
    setupConfidence: Number(conf.toFixed(2)),
    tier: confidenceTier(conf),
    reasons: ["uptrend_pullback", "controlled_reentry"],
    invalidating: [],
  };
}

function evaluateVolatilityExpansion(f: MarketStateFeatures, ctx: MarketContext): SetupEvaluation | null {
  if (f.atrPercent < 0.55 || f.atrPercent > 3.2) return null;
  if (f.volumeRatio20 < 1.0) return null;
  if (f.return15m < 0.12) return null;
  if (ctx.pumpRisk > 70) return null;

  let conf = 34;
  conf += clamp(f.atrPercent * 8, 0, 14);
  conf += clamp(f.volumeAcceleration * 15, 0, 12);
  conf += clamp(f.return15m * 6, 0, 14);
  conf = clamp(conf, 0, 85);
  return {
    family: "VOLATILITY_EXPANSION",
    setupConfidence: Number(conf.toFixed(2)),
    tier: confidenceTier(conf),
    reasons: ["vol_expansion", "volume_surge"],
    invalidating: [],
  };
}

export function evaluateDiscoveryV2Setups(input: {
  context: MarketContext;
  features: MarketStateFeatures;
}): SetupEvaluation | null {
  const { context, features } = input;
  const candidates = [
    evaluateVolumeConfirmedMomentum(features, context),
    evaluateBreakoutContinuation(features, context),
    evaluateTrendPullback(features),
    evaluateVolatilityExpansion(features, context),
  ].filter((c): c is SetupEvaluation => c !== null);

  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.setupConfidence - a.setupConfidence)[0] ?? null;
}

export function discoverV2CandidatesInWindow(rows: DiscoveryV2Candidate[]): DiscoveryV2Candidate[] {
  const bySymbol = new Map<string, DiscoveryV2Candidate>();
  for (const row of rows) {
    const prev = bySymbol.get(row.symbol);
    if (!prev || row.setup.setupConfidence > prev.setup.setupConfidence) {
      bySymbol.set(row.symbol, row);
    }
  }
  return [...bySymbol.values()]
    .filter((r) => r.setup.setupConfidence >= DISCOVERY_V2_POLICY.shortlistMinConfidence)
    .sort((a, b) => b.setup.setupConfidence - a.setup.setupConfidence)
    .slice(0, DISCOVERY_V2_POLICY.maxShortlistPerWindow);
}

export type ForensicExcursion = {
  mfe: Record<string, number>;
  mae: Record<string, number>;
  maximumNetOpportunity: number;
  qualityClass: QualityClass;
};

export function computeForensicExcursion(input: {
  klines: KlineItem[];
  idx: number;
  roundTripCostPct: number;
}): ForensicExcursion {
  const entry = input.klines[input.idx]?.close ?? 0;
  const horizons = [15, 30, 60, 90, 120];
  const mfe: Record<string, number> = {};
  const mae: Record<string, number> = {};
  let maxNet = -Infinity;

  for (const h of horizons) {
    const slice = input.klines.slice(input.idx + 1, input.idx + 1 + h);
    if (entry <= 0 || !slice.length) {
      mfe[`mfe${h}`] = 0;
      mae[`mae${h}`] = 0;
      continue;
    }
    let peak = 0;
    let trough = 0;
    for (const c of slice) {
      peak = Math.max(peak, ((c.high - entry) / entry) * 100);
      trough = Math.min(trough, ((c.low - entry) / entry) * 100);
    }
    mfe[`mfe${h}`] = Number(peak.toFixed(4));
    mae[`mae${h}`] = Number(trough.toFixed(4));
    const netAtPeak = peak - input.roundTripCostPct;
    const netConservative = netAtPeak + Math.min(0, trough) * 0.35;
    maxNet = Math.max(maxNet, netConservative);
  }

  const maximumNetOpportunity = Number(maxNet.toFixed(4));
  let qualityClass: QualityClass = "NO_EDGE";
  if (maximumNetOpportunity >= DISCOVERY_V2_POLICY.strongPositiveEdgeMinNetPct) {
    qualityClass = "STRONG_POSITIVE_EDGE";
  } else if (maximumNetOpportunity >= DISCOVERY_V2_POLICY.weakPositiveEdgeMinNetPct) {
    qualityClass = "WEAK_POSITIVE_EDGE";
  } else if (maximumNetOpportunity < -DISCOVERY_V2_POLICY.weakPositiveEdgeMinNetPct) {
    qualityClass = "NEGATIVE_EDGE";
  }

  return { mfe, mae, maximumNetOpportunity, qualityClass };
}

export function isPositiveEdgeClass(q: QualityClass): boolean {
  return q === "STRONG_POSITIVE_EDGE" || q === "WEAK_POSITIVE_EDGE";
}

export function checkConfidenceMonotonicity(
  buckets: Array<{ tier: SetupEvaluation["tier"]; positiveRate: number; count: number }>,
): boolean {
  const order = ["LOW", "MEDIUM", "HIGH", "ELITE"] as const;
  const meaningful = buckets.filter((b) => b.count >= 8);
  if (meaningful.length < 2) return false;
  for (let i = 1; i < meaningful.length; i += 1) {
    const prevIdx = order.indexOf(meaningful[i - 1].tier);
    const curIdx = order.indexOf(meaningful[i].tier);
    if (curIdx > prevIdx && meaningful[i].positiveRate < meaningful[i - 1].positiveRate - 3) {
      return false;
    }
  }
  return true;
}
