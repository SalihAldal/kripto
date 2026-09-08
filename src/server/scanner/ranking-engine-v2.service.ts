import type { MarketContext } from "@/src/types/scanner";
import type { ScannerScore } from "@/src/types/scanner";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";

/** Explainable ranking models — no black-box optimization. */
export const RANKING_ENGINE_V2_MODELS = ["MODEL_A", "MODEL_B", "MODEL_C"] as const;
export type RankingEngineV2Model = (typeof RANKING_ENGINE_V2_MODELS)[number];

export type ScoreDecomposition = {
  baseScore: number;
  weightedContributions: {
    momentum: number;
    microMomentum: number;
    volume: number;
    spread: number;
    volatility: number;
    orderBook: number;
    pressure: number;
    microFlow: number;
    velocity: number;
    candle: number;
    pumpBoost: number;
    penalties: number;
    regimeBoost: number;
    liquidityPenalty: number;
  };
  netRaw: number;
};

const WEIGHTS = {
  momentum: 0.12,
  microMomentum: 0.16,
  volume: 0.14,
  spread: 0.12,
  volatility: 0.08,
  orderBook: 0.12,
  pressure: 0.1,
  microFlow: 0.08,
  velocity: 0.08,
  candle: 0.1,
  pumpBoost: 0.06,
  pumpRiskPenalty: -0.1,
  fakeSpikePenalty: -0.12,
  futuresRiskPenalty: -0.08,
  leverageStressPenalty: -0.06,
  regimeTransitionPenalty: -0.07,
  regimeFlipPenalty: -0.05,
  regimeStabilityBoost: 0.035,
} as const;

export function decomposeScannerScore(context: MarketContext): ScoreDecomposition {
  const score = scoreContext(context);
  const m = score.metrics;
  const penalties =
    (m.pumpRiskPenalty ?? 0) * WEIGHTS.pumpRiskPenalty +
    (m.fakeSpikePenalty ?? 0) * WEIGHTS.fakeSpikePenalty +
    (m.futuresRiskPenalty ?? 0) * WEIGHTS.futuresRiskPenalty +
    (m.leverageStressPenalty ?? 0) * WEIGHTS.leverageStressPenalty +
    (m.regimeTransitionPenalty ?? 0) * WEIGHTS.regimeTransitionPenalty +
    (m.regimeFlipPenalty ?? 0) * WEIGHTS.regimeFlipPenalty;

  const weightedContributions = {
    momentum: m.momentum * WEIGHTS.momentum,
    microMomentum: m.microMomentum * WEIGHTS.microMomentum,
    volume: m.volume * WEIGHTS.volume,
    spread: m.spread * WEIGHTS.spread,
    volatility: m.volatility * WEIGHTS.volatility,
    orderBook: m.orderBook * WEIGHTS.orderBook,
    pressure: m.pressure * WEIGHTS.pressure,
    microFlow: m.microFlow * WEIGHTS.microFlow,
    velocity: m.velocity * WEIGHTS.velocity,
    candle: m.candle * WEIGHTS.candle,
    pumpBoost: m.pumpBoost * WEIGHTS.pumpBoost,
    penalties: Number(penalties.toFixed(4)),
    regimeBoost: (m.regimeStabilityBoost ?? 0) * WEIGHTS.regimeStabilityBoost,
    liquidityPenalty: -m.liquidityPenalty,
  };

  const netRaw = Object.values(weightedContributions).reduce((s, v) => s + v, 0);
  return { baseScore: score.score, weightedContributions, netRaw: Number(netRaw.toFixed(4)) };
}

export type WindowCandidateFeatures = {
  symbol: string;
  context: MarketContext;
  score: ScannerScore;
  volumeRatio20: number;
  volumePersistence: number;
  return5m: number;
  return15m: number;
  return30m: number;
  momentumSlope: number;
  extensionFromLow: number;
  distanceFromHigh: number;
  spreadPercent: number;
  liquidity24h: number;
  volatilityPercent: number;
  rsi14: number;
  microScore: number;
  trendAlignment: number;
};

export function extractWindowCandidateFeatures(context: MarketContext, score: ScannerScore): WindowCandidateFeatures {
  const shortMom = Number(context.metadata.shortMomentumPercent ?? 0);
  const hourMom = Number(context.metadata.hourMomentumPercent ?? 0);
  const midMom = Number(context.momentumPercent ?? 0);
  const volumeRatio20 = Number(context.metadata.volumeRatio20 ?? 1);
  const recentVol = Number(context.metadata.recentVolumeAvg ?? 0);
  const baseVol = Number(context.metadata.baseVolumeAvg ?? 1);
  const volPersistence = baseVol > 0 ? recentVol / baseVol : volumeRatio20;

  return {
    symbol: context.symbol,
    context,
    score,
    volumeRatio20,
    volumePersistence: volPersistence,
    return5m: shortMom * 0.85,
    return15m: shortMom * 2.2,
    return30m: hourMom * 0.55,
    momentumSlope: shortMom - hourMom * 0.3,
    extensionFromLow: Number(context.metadata.extensionFrom60mLowPercent ?? 0),
    distanceFromHigh: Number(context.metadata.distanceFrom60mHighPercent ?? 0),
    spreadPercent: context.spreadPercent,
    liquidity24h: context.volume24h,
    volatilityPercent: context.volatilityPercent,
    rsi14: Number(context.metadata.rsi14 ?? 50),
    microScore: Number(score.metrics.microMomentum + score.metrics.microFlow + score.metrics.orderBook) / 3,
    trendAlignment: shortMom > 0 && hourMom > 0 && midMom > 0 ? 1 : shortMom > 0 && midMom > 0 ? 0.6 : 0.2,
  };
}

/** Percentile rank within window [0,1]. Higher = better for "higherIsBetter" features. */
export function percentileRank(values: number[], value: number, higherIsBetter = true): number {
  if (values.length <= 1) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < value).length;
  const rank = below / (sorted.length - 1);
  return higherIsBetter ? rank : 1 - rank;
}

export type RelativeFeatureRanks = {
  volumeRank: number;
  momentumRank: number;
  liquidityRank: number;
  spreadRank: number;
  volatilityRank: number;
  overextensionRank: number;
  microRank: number;
  trendRank: number;
};

export function computeRelativeRanks(candidates: WindowCandidateFeatures[]): Map<string, RelativeFeatureRanks> {
  const vols = candidates.map((c) => c.volumeRatio20);
  const moms = candidates.map((c) => c.return15m);
  const liqs = candidates.map((c) => c.liquidity24h);
  const spreads = candidates.map((c) => c.spreadPercent);
  const volas = candidates.map((c) => c.volatilityPercent);
  const extensions = candidates.map((c) => c.extensionFromLow);
  const micros = candidates.map((c) => c.microScore);
  const trends = candidates.map((c) => c.trendAlignment);

  const out = new Map<string, RelativeFeatureRanks>();
  for (const c of candidates) {
    out.set(c.symbol, {
      volumeRank: percentileRank(vols, c.volumeRatio20, true),
      momentumRank: percentileRank(moms, c.return15m, true),
      liquidityRank: percentileRank(liqs, c.liquidity24h, true),
      spreadRank: percentileRank(spreads, c.spreadPercent, false),
      volatilityRank: percentileRank(volas, c.volatilityPercent, false),
      overextensionRank: percentileRank(extensions, c.extensionFromLow, false),
      microRank: percentileRank(micros, c.microScore, true),
      trendRank: percentileRank(trends, c.trendAlignment, true),
    });
  }
  return out;
}

export function computeRankingV2Score(model: RankingEngineV2Model, ranks: RelativeFeatureRanks): number {
  const baseA =
    ranks.volumeRank * 0.4 + ranks.momentumRank * 0.25 + ranks.trendRank * 0.2 + ranks.spreadRank * 0.15;

  if (model === "MODEL_A") return Number((baseA * 100).toFixed(4));

  const baseB = baseA * 0.85 + ranks.overextensionRank * 0.15;
  if (model === "MODEL_B") return Number((baseB * 100).toFixed(4));

  const baseC =
    baseB * 0.7 + ranks.microRank * 0.15 + ranks.liquidityRank * 0.1 + ranks.volatilityRank * 0.05;
  return Number((baseC * 100).toFixed(4));
}

/** Production baseline ranking (score + top gainer boost). */
export function computeBaselineRankingScore(context: MarketContext, score: ScannerScore): number {
  const boost = Number(context.metadata.topGainerPriorityScore ?? 0) * 0.18;
  return Number((score.score + boost).toFixed(4));
}

export function pickTopCandidate<T extends { symbol: string }>(
  candidates: T[],
  scoreFn: (c: T) => number,
): T | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => scoreFn(b) - scoreFn(a))[0] ?? null;
}

export type ScoreSaturationStats = {
  count80Plus: number;
  count85Plus: number;
  count90Plus: number;
  mean: number;
  median: number;
  stddev: number;
  p10: number;
  p50: number;
  p90: number;
};

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

export function computeScoreSaturation(scores: number[]): ScoreSaturationStats {
  const sorted = [...scores].sort((a, b) => a - b);
  const mean = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  const variance = scores.length
    ? scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length
    : 0;
  return {
    count80Plus: scores.filter((s) => s >= 80).length,
    count85Plus: scores.filter((s) => s >= 85).length,
    count90Plus: scores.filter((s) => s >= 90).length,
    mean: Number(mean.toFixed(4)),
    median: quantile(sorted, 0.5),
    stddev: Number(Math.sqrt(variance).toFixed(4)),
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
  };
}
