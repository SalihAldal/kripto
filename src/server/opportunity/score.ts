import { LANE_WEIGHTS } from "@/src/server/opportunity/config";
import { clamp, signedScore } from "@/src/server/opportunity/normalize";
import type {
  OpportunityFeatures,
  OpportunityLane,
  OpportunityReasonCode,
  ScoreBreakdown,
} from "@/src/server/opportunity/types";

export function buildScoreBreakdown(features: OpportunityFeatures): ScoreBreakdown {
  const breakoutCombined = Math.max(features.breakout3m, features.breakout5m);
  const volumeConfirmedBreakout =
    breakoutCombined > 0.15 && features.rvol1m > 1.4 && features.velocity15s > 0
      ? breakoutCombined * 1.35
      : breakoutCombined;
  return {
    priceVelocity: signedScore(features.velocity15s, 0.8),
    priceAcceleration: signedScore(
      features.priceAccelerationShort * 0.6 + features.priceAccelerationMedium * 0.4,
      0.45,
    ),
    volumeAcceleration: signedScore(features.volumeAcceleration, Math.max(8_000, features.volume1m * 0.6 || 8_000)),
    relativeVolume: signedScore(features.rvol1m - 1, 2.2),
    relativeStrength: signedScore(
      features.relativeStrengthBTC1m * 0.5 + features.relativeStrengthMarket * 0.5,
      0.55,
    ),
    breakout: signedScore(volumeConfirmedBreakout, 0.8),
    compressionExpansion: signedScore(features.expansionScore - 0.35 + features.compressionScore * 0.2, 0.4),
    consistency: signedScore(features.momentumConsistency, 0.45),
    retracementQuality: signedScore(1.2 - features.retracementRatio - features.maxRetracement * 0.15, 0.8),
    exhaustion: -Math.abs(signedScore(features.exhaustionScore, 35)),
    chaseControl: -Math.abs(signedScore(features.chaseRisk, 8)),
    liquidity: signedScore(Math.log10(Math.max(1, features.quoteVolume24h)) - 5.5, 1.2),
  };
}

export function scoreLane(lane: OpportunityLane, breakdown: ScoreBreakdown, features: OpportunityFeatures): number {
  const weights = LANE_WEIGHTS[lane];
  let weighted = 0;
  (Object.keys(weights) as Array<keyof ScoreBreakdown>).forEach((key) => {
    weighted += breakdown[key] * weights[key];
  });
  const hasEarlyMove =
    features.return5m >= 0.25 || (features.return1m >= 0.15 && features.priceAccelerationShort > 0);
  const longBias = hasEarlyMove ? 52 : 0;
  let raw = longBias + weighted * 0.42;
  if (features.return5m < 0 && features.return1m < 0) {
    raw = Math.min(0, weighted);
  }
  return clamp(raw, -20, 100);
}

export function eligibleLanes(features: OpportunityFeatures): OpportunityLane[] {
  const lanes: OpportunityLane[] = [];
  const move = features.return5m;
  if (move > 0.12 && move < 4.2 && features.priceAccelerationShort >= -0.05) lanes.push("EARLY");
  if (
    move > 0.25 &&
    move < 3.8 &&
    features.momentumConsistency > 0.35 &&
    features.maxRetracement < 1.2 &&
    features.priceAccelerationShort < 1.1
  ) {
    lanes.push("STEADY");
  }
  if (move > 2.4 && move < 12 && features.exhaustionScore < 70) lanes.push("MOMENTUM");
  if (
    (features.return15m > 8 || features.change24h > 10) &&
    features.maxRetracement < 4.5 &&
    features.volumeAcceleration > 0 &&
    features.exhaustionScore < 50
  ) {
    lanes.push("CONTINUATION");
  }
  return lanes;
}

export function reasonCodesFor(features: OpportunityFeatures, breakdown: ScoreBreakdown): OpportunityReasonCode[] {
  const codes: OpportunityReasonCode[] = [];
  if (breakdown.priceAcceleration > 12) codes.push("EARLY_PRICE_ACCELERATION");
  if (breakdown.volumeAcceleration > 12) codes.push("EARLY_VOLUME_ACCELERATION", "VOLUME_ACCELERATION");
  if (features.rvol1m >= 2.2) codes.push("RVOL_SPIKE");
  if (breakdown.relativeStrength > 10) codes.push("RELATIVE_STRENGTH");
  if (features.distanceTo5mHigh > 0 && features.distanceTo5mHigh < 0.35) codes.push("BREAKOUT_NEAR");
  if (features.breakout5m > 0.2 && features.rvol1m > 1.3) codes.push("BREAKOUT_CONFIRMED");
  if (features.momentumConsistency > 0.35 && features.return5m > 0.3) codes.push("STEADY_TREND");
  if (features.return5m > 3 && breakdown.priceVelocity > 8) codes.push("MOMENTUM_PERSISTENCE");
  if (features.return15m > 8 && features.recoverySpeed > 0.4) codes.push("CONTINUATION_RECOVERY");
  if (breakdown.compressionExpansion > 8) codes.push("COMPRESSION_EXPANSION");
  return [...new Set(codes)];
}

export function pickPrimaryLane(
  lanes: OpportunityLane[],
  laneScores: Record<OpportunityLane, number>,
  features?: OpportunityFeatures,
): OpportunityLane {
  if (!lanes.length) {
    const entries = Object.entries(laneScores) as Array<[OpportunityLane, number]>;
    entries.sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] ?? "EARLY";
  }
  if (lanes.includes("CONTINUATION")) return "CONTINUATION";
  if (features && features.return5m < 3.2 && lanes.includes("EARLY")) {
    if (!lanes.includes("STEADY") || features.priceAccelerationShort >= 1) {
      return "EARLY";
    }
  }
  return lanes.slice().sort((a, b) => laneScores[b] - laneScores[a])[0];
}
