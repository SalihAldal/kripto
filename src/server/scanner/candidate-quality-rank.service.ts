import type { MarketContext } from "@/src/types/scanner";

/**
 * Evidence-based ranking adjustments from 72h scanner forensic (dev split).
 * Ranking-only — no hard scanner threshold changes.
 * Derived: overextension + volume-spike exhaustion separate losers from winners.
 */
export const CANDIDATE_QUALITY_RANK_POLICY = {
  /** 15m return above this → late-entry / pump-chase penalty (dev loser p60). */
  return15mPenaltyStartPct: 0.42,
  return15mPenaltyWeight: -7.5,
  /** Extension from 60m low — losers chase extended moves. */
  extensionFromLowPenaltyStartPct: 2.2,
  extensionFromLowPenaltyWeight: -5.5,
  /** Sitting at 60m high — poor follow-through risk. */
  distanceFromHighPenaltyMaxPct: 0.4,
  distanceFromHighPenaltyWeight: -4.5,
  /** Single-candle volume spike without follow-through. */
  volumeSpikeExhaustionRatio: 2.15,
  volumeSpikeExhaustionPenalty: -4,
  /** Sustainable relative volume band (winner median band). */
  volumePersistenceSweetMin: 1.08,
  volumePersistenceSweetMax: 1.75,
  volumePersistenceBoost: 3.5,
  /** Short momentum positive but hour flat — weak alignment penalty. */
  momentumDivergencePenalty: -3,
  momentumDivergenceShortMin: 0.12,
  momentumDivergenceHourMax: 0.04,
} as const;

export type CandidateQualityRankBreakdown = {
  overextensionPenalty: number;
  nearHighPenalty: number;
  volumeExhaustionPenalty: number;
  volumePersistenceBoost: number;
  momentumDivergencePenalty: number;
  totalAdjustment: number;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/** Production-computable pre-decision returns from context metadata. */
export function resolvePreDecisionReturns(context: MarketContext) {
  const shortMom = Number(context.metadata.shortMomentumPercent ?? 0);
  const hourMom = Number(context.metadata.hourMomentumPercent ?? 0);
  const midMom = Number(context.momentumPercent ?? 0);
  return {
    return5m: shortMom * 0.85,
    return15m: shortMom * 2.2,
    return30m: hourMom * 0.55,
    shortMomentum: shortMom,
    hourMomentum: hourMom,
    midMomentum: midMom,
  };
}

export function computeCandidateQualityRankAdjustment(context: MarketContext): CandidateQualityRankBreakdown {
  const p = CANDIDATE_QUALITY_RANK_POLICY;
  const returns = resolvePreDecisionReturns(context);
  const extensionFromLow = Number(context.metadata.extensionFrom60mLowPercent ?? 0);
  const distanceFromHigh = Number(context.metadata.distanceFrom60mHighPercent ?? 0);
  const volumeRatio20 = Number(context.metadata.volumeRatio20 ?? 1);
  const volumeSpike = Number(context.volumeSpikePercent ?? 0);

  const overextensionPenalty =
    returns.return15m > p.return15mPenaltyStartPct
      ? clamp((returns.return15m - p.return15mPenaltyStartPct) * p.return15mPenaltyWeight, -18, 0)
      : extensionFromLow > p.extensionFromLowPenaltyStartPct
        ? clamp((extensionFromLow - p.extensionFromLowPenaltyStartPct) * p.extensionFromLowPenaltyWeight, -14, 0)
        : 0;

  const nearHighPenalty =
    distanceFromHigh < p.distanceFromHighPenaltyMaxPct
      ? clamp((p.distanceFromHighPenaltyMaxPct - distanceFromHigh) * p.distanceFromHighPenaltyWeight, -12, 0)
      : 0;

  const volumeExhaustionPenalty =
    volumeRatio20 >= p.volumeSpikeExhaustionRatio && volumeSpike > 80 && returns.return15m > 0.25
      ? p.volumeSpikeExhaustionPenalty
      : 0;

  const volumePersistenceBoost =
    volumeRatio20 >= p.volumePersistenceSweetMin &&
    volumeRatio20 <= p.volumePersistenceSweetMax &&
    volumeSpike > 5 &&
    volumeSpike < 90
      ? p.volumePersistenceBoost
      : 0;

  const momentumDivergencePenalty =
    returns.shortMomentum >= p.momentumDivergenceShortMin && Math.abs(returns.hourMomentum) <= p.momentumDivergenceHourMax
      ? p.momentumDivergencePenalty
      : 0;

  const totalAdjustment = Number(
    (
      overextensionPenalty +
      nearHighPenalty +
      volumeExhaustionPenalty +
      volumePersistenceBoost +
      momentumDivergencePenalty
    ).toFixed(2),
  );

  return {
    overextensionPenalty,
    nearHighPenalty,
    volumeExhaustionPenalty,
    volumePersistenceBoost,
    momentumDivergencePenalty,
    totalAdjustment,
  };
}

export function computeEvidenceAdjustedRankingScore(input: {
  baseScore: number;
  context: MarketContext;
  topGainerBoost?: number;
}): { rankingScore: number; breakdown: CandidateQualityRankBreakdown } {
  const boost = input.topGainerBoost ?? Number(input.context.metadata.topGainerPriorityScore ?? 0) * 0.18;
  const breakdown = computeCandidateQualityRankAdjustment(input.context);
  const rankingScore = Number((input.baseScore + boost + breakdown.totalAdjustment).toFixed(2));
  return { rankingScore, breakdown };
}
