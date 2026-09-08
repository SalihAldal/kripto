import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";
import {
  extractMarketStateFeatures,
  type MarketStateFeatures,
} from "@/src/server/scanner/scanner-discovery-v2.service";

export const SETUP_FAMILY_NAMES = [
  "BREAKOUT_CONTINUATION",
  "TREND_PULLBACK",
  "VOLUME_CONFIRMED_MOMENTUM",
  "MEAN_REVERSION",
  "VOLATILITY_EXPANSION",
  "RANGE_BREAK",
  "POST_SPIKE_CONSOLIDATION",
] as const;

export type SetupFamilyName = (typeof SETUP_FAMILY_NAMES)[number];

export type SetupFamilyContract = {
  setupName: SetupFamilyName;
  marketRegime: string[];
  entryContext: string;
  expectedHoldingWindowMin: number;
  riskProfile: "moderate" | "aggressive" | "conservative";
  exitStyle: "trailing" | "fixed_tp" | "mean_target";
  defaultExit: { tpPct: number; slPct: number; holdMin: number };
};

export type SetupFamilyHit = {
  family: SetupFamilyName;
  setupConfidence: number;
  tier: "LOW" | "MEDIUM" | "HIGH" | "ELITE";
  reasons: string[];
};

export const SETUP_CONTRACTS: Record<SetupFamilyName, SetupFamilyContract> = {
  BREAKOUT_CONTINUATION: {
    setupName: "BREAKOUT_CONTINUATION",
    marketRegime: ["TREND_UP", "RANGE_SIDEWAYS"],
    entryContext: "resistance break + volume follow-through",
    expectedHoldingWindowMin: 60,
    riskProfile: "moderate",
    exitStyle: "trailing",
    defaultExit: { tpPct: 2.5, slPct: 0.85, holdMin: 90 },
  },
  TREND_PULLBACK: {
    setupName: "TREND_PULLBACK",
    marketRegime: ["TREND_UP"],
    entryContext: "HTF uptrend + short retracement + re-expansion",
    expectedHoldingWindowMin: 45,
    riskProfile: "conservative",
    exitStyle: "fixed_tp",
    defaultExit: { tpPct: 1.6, slPct: 0.7, holdMin: 60 },
  },
  VOLUME_CONFIRMED_MOMENTUM: {
    setupName: "VOLUME_CONFIRMED_MOMENTUM",
    marketRegime: ["TREND_UP", "RANGE_SIDEWAYS"],
    entryContext: "momentum + persistent relative volume",
    expectedHoldingWindowMin: 60,
    riskProfile: "moderate",
    exitStyle: "fixed_tp",
    defaultExit: { tpPct: 2.2, slPct: 0.8, holdMin: 75 },
  },
  MEAN_REVERSION: {
    setupName: "MEAN_REVERSION",
    marketRegime: ["RANGE_SIDEWAYS", "LOW_VOLATILITY_CALM"],
    entryContext: "extreme deviation + liquid symbol + reversion context",
    expectedHoldingWindowMin: 30,
    riskProfile: "conservative",
    exitStyle: "mean_target",
    defaultExit: { tpPct: 1.0, slPct: 0.6, holdMin: 45 },
  },
  VOLATILITY_EXPANSION: {
    setupName: "VOLATILITY_EXPANSION",
    marketRegime: ["RANGE_SIDEWAYS", "HIGH_VOLATILITY_CHAOS"],
    entryContext: "compression → expansion + volume pickup",
    expectedHoldingWindowMin: 60,
    riskProfile: "aggressive",
    exitStyle: "trailing",
    defaultExit: { tpPct: 2.5, slPct: 0.9, holdMin: 75 },
  },
  RANGE_BREAK: {
    setupName: "RANGE_BREAK",
    marketRegime: ["RANGE_SIDEWAYS"],
    entryContext: "range boundary break with confirmation",
    expectedHoldingWindowMin: 75,
    riskProfile: "moderate",
    exitStyle: "fixed_tp",
    defaultExit: { tpPct: 2.0, slPct: 0.75, holdMin: 80 },
  },
  POST_SPIKE_CONSOLIDATION: {
    setupName: "POST_SPIKE_CONSOLIDATION",
    marketRegime: ["TREND_UP", "RANGE_SIDEWAYS"],
    entryContext: "spike → consolidation → continuation",
    expectedHoldingWindowMin: 90,
    riskProfile: "moderate",
    exitStyle: "trailing",
    defaultExit: { tpPct: 2.8, slPct: 0.8, holdMin: 90 },
  },
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function tier(score: number): SetupFamilyHit["tier"] {
  if (score >= 72) return "ELITE";
  if (score >= 58) return "HIGH";
  if (score >= 45) return "MEDIUM";
  return "LOW";
}

function detectBreakout(f: MarketStateFeatures, ctx: MarketContext): SetupFamilyHit | null {
  if (f.distanceFrom60mHigh > 1.2) return null;
  if (f.extensionFrom60mLow < 1.0 || f.extensionFrom60mLow > 5.0) return null;
  if (f.volumeRatio20 < 0.95 || f.return15m < 0.1) return null;
  if (f.spreadPercent > 0.14) return null;
  let c = 38 + clamp(f.return15m * 7, 0, 18) + clamp((f.volumeRatio20 - 0.9) * 20, 0, 14);
  c += f.return5m > 0.06 ? 8 : 0;
  c -= ctx.pumpRisk > 65 ? 10 : 0;
  return { family: "BREAKOUT_CONTINUATION", setupConfidence: clamp(c, 0, 92), tier: tier(c), reasons: ["resistance_break", "volume_confirm"] };
}

function detectPullback(f: MarketStateFeatures): SetupFamilyHit | null {
  if (f.return60m < 0.15) return null;
  if (f.return5m < 0.02 || f.return5m > 0.12) return null;
  if (f.return15m < 0.04 || f.return15m > 0.3) return null;
  if (f.volumeRatio20 < 0.7) return null;
  if (f.rsi14 > 74) return null;
  let c = 36 + clamp(f.return60m * 5, 0, 16) + (f.volumeRatio5 < f.volumeRatio20 ? 10 : 0);
  return { family: "TREND_PULLBACK", setupConfidence: clamp(c, 0, 88), tier: tier(c), reasons: ["htf_uptrend", "pullback_reentry"] };
}

function detectVolumeMomentum(f: MarketStateFeatures, ctx: MarketContext): SetupFamilyHit | null {
  if (f.volumeRatio20 < 0.88 || f.volumeRatio20 > 1.9) return null;
  if (f.return15m < 0.08) return null;
  if (f.return60m < 0) return null;
  if (f.distanceFrom60mHigh < 0.4) return null;
  if (ctx.fakeSpikeScore > 1.5) return null;
  let c = 40 + clamp(f.priceVolumeConfirmation * 0.2, 0, 15) + clamp(f.volumePersistence * 8, 0, 12);
  c += f.btcReturn15m >= 0 ? 6 : -8;
  return { family: "VOLUME_CONFIRMED_MOMENTUM", setupConfidence: clamp(c, 0, 90), tier: tier(c), reasons: ["persistent_volume", "pv_aligned"] };
}

function detectMeanReversion(f: MarketStateFeatures): SetupFamilyHit | null {
  if (f.rsi14 > 32 && f.rsi14 < 68) return null;
  if (f.realizedVolatility > 2.5) return null;
  if (f.liquidity24h < 500_000) return null;
  const oversold = f.rsi14 <= 32 && f.return15m < -0.15;
  const overbought = f.rsi14 >= 68 && f.return15m > 0.2;
  if (!oversold && !overbought) return null;
  let c = 34 + clamp(Math.abs(50 - f.rsi14), 0, 20);
  c += f.volumeRatio20 < 1.3 ? 6 : 0;
  return { family: "MEAN_REVERSION", setupConfidence: clamp(c, 0, 82), tier: tier(c), reasons: ["extreme_deviation", "liquid_symbol"] };
}

function detectVolExpansion(f: MarketStateFeatures, ctx: MarketContext): SetupFamilyHit | null {
  if (f.atrPercent < 0.5 || f.atrPercent > 3.0) return null;
  if (f.volumeRatio20 < 1.05) return null;
  if (f.return15m < 0.1) return null;
  if (ctx.pumpRisk > 72) return null;
  const compressed = f.realizedVolatility < 1.0 && f.volumeAcceleration > 0.15;
  if (!compressed && f.volumeAcceleration < 0.1) return null;
  let c = 35 + clamp(f.atrPercent * 7, 0, 14) + clamp(f.volumeAcceleration * 12, 0, 12);
  return { family: "VOLATILITY_EXPANSION", setupConfidence: clamp(c, 0, 85), tier: tier(c), reasons: ["vol_compression_expansion"] };
}

function detectRangeBreak(f: MarketStateFeatures): SetupFamilyHit | null {
  if (f.symbolRegime !== "RANGE_SIDEWAYS") return null;
  if (f.distanceFrom20mHigh > 1.5 && f.distanceFrom20mLow > 1.5) return null;
  if (f.return15m < 0.08 || f.volumeRatio20 < 0.9) return null;
  let c = 36 + clamp(f.return15m * 6, 0, 14) + clamp(f.volumeRatio20 * 8, 0, 12);
  return { family: "RANGE_BREAK", setupConfidence: clamp(c, 0, 84), tier: tier(c), reasons: ["range_boundary_break"] };
}

function detectPostSpike(f: MarketStateFeatures, ctx: MarketContext): SetupFamilyHit | null {
  if (f.extensionFrom60mLow < 2.5 || f.extensionFrom60mLow > 7) return null;
  if (f.return5m < 0.02 || f.return5m > 0.1) return null;
  if (f.return15m > 0.35) return null;
  if (f.volumeRatio5 < 0.85 || f.volumeRatio5 > 1.4) return null;
  if (ctx.volumeSpikePercent < 30) return null;
  let c = 37 + clamp(f.extensionFrom60mLow * 3, 0, 14) + (f.return5m > 0.03 && f.return15m < 0.2 ? 10 : 0);
  return { family: "POST_SPIKE_CONSOLIDATION", setupConfidence: clamp(c, 0, 86), tier: tier(c), reasons: ["spike_consolidation_continue"] };
}

export function evaluateAllSetupFamilies(input: {
  context: MarketContext;
  klines: KlineItem[];
  idx: number;
  btcKlines?: KlineItem[];
  btcIdx?: number;
}): SetupFamilyHit[] {
  const features = extractMarketStateFeatures(input);
  const hits = [
    detectBreakout(features, input.context),
    detectPullback(features),
    detectVolumeMomentum(features, input.context),
    detectMeanReversion(features),
    detectVolExpansion(features, input.context),
    detectRangeBreak(features),
    detectPostSpike(features, input.context),
  ].filter((h): h is SetupFamilyHit => h !== null);
  return hits.sort((a, b) => b.setupConfidence - a.setupConfidence);
}

export function pickBestSetupPerSymbol(hits: SetupFamilyHit[]): SetupFamilyHit | null {
  return hits[0] ?? null;
}

export function buildDiversifiedShortlist(
  rows: Array<{ symbol: string; hit: SetupFamilyHit }>,
  maxN = 3,
): Array<{ symbol: string; hit: SetupFamilyHit }> {
  const usedFamilies = new Set<string>();
  const out: Array<{ symbol: string; hit: SetupFamilyHit }> = [];
  const sorted = [...rows].sort((a, b) => b.hit.setupConfidence - a.hit.setupConfidence);
  for (const row of sorted) {
    if (out.some((r) => r.symbol === row.symbol)) continue;
    if (usedFamilies.has(row.hit.family) && out.length >= 1) continue;
    out.push(row);
    usedFamilies.add(row.hit.family);
    if (out.length >= maxN) break;
  }
  return out;
}

export function checkSetupMonotonicity(
  buckets: Array<{ tier: SetupFamilyHit["tier"]; positiveRate: number; count: number }>,
): boolean {
  const order = ["LOW", "MEDIUM", "HIGH", "ELITE"] as const;
  const meaningful = buckets.filter((b) => b.count >= 6);
  if (meaningful.length < 2) return false;
  for (let i = 1; i < meaningful.length; i += 1) {
    const pi = order.indexOf(meaningful[i - 1].tier);
    const ci = order.indexOf(meaningful[i].tier);
    if (ci > pi && meaningful[i].positiveRate < meaningful[i - 1].positiveRate - 4) return false;
  }
  return true;
}
