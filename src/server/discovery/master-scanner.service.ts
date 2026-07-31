import type { DiscoveryTier } from "@prisma/client";
import type {
  DiscoveryProfileOutput,
  LaneScoreResult,
  ScannerProfileDimensions,
} from "@/src/server/discovery/discovery.types";

function avg(scores: number[]) {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, value) => sum + value, 0) / scores.length;
}

function laneScore(lanes: LaneScoreResult[], lane: string) {
  return lanes.find((row) => row.lane === lane)?.score ?? 0;
}

export function buildScannerProfileDimensions(laneScores: LaneScoreResult[]): ScannerProfileDimensions {
  return {
    momentum: laneScore(laneScores, "MOMENTUM"),
    trend: laneScore(laneScores, "TREND"),
    volume: avg([laneScore(laneScores, "VOLUME_EXPLOSION"), laneScore(laneScores, "HIGH_VOLUME")]),
    whale: laneScore(laneScores, "WHALE"),
    news: laneScore(laneScores, "NEWS"),
    liquidity: laneScore(laneScores, "ORDERBOOK"),
    funding: avg([laneScore(laneScores, "FUNDING"), laneScore(laneScores, "OPEN_INTEREST")]),
    risk: avg([laneScore(laneScores, "ANOMALY"), laneScore(laneScores, "LIQUIDATION")]),
    relativeStrength: laneScore(laneScores, "RELATIVE_STRENGTH"),
    volatility: avg([laneScore(laneScores, "BREAKOUT"), laneScore(laneScores, "ANOMALY")]),
    breakout: laneScore(laneScores, "BREAKOUT"),
    continuation: avg([laneScore(laneScores, "MOMENTUM"), laneScore(laneScores, "TREND")]),
    exhaustion: avg([laneScore(laneScores, "ANOMALY"), 100 - laneScore(laneScores, "SMART_MONEY")]),
  };
}

export function mergeMasterScannerScore(input: {
  laneScores: LaneScoreResult[];
  dimensions: ScannerProfileDimensions;
  healthDataQuality: number;
}): { opportunityScore: number; confidence: number; laneLeader: string } {
  const laneAvg = avg(input.laneScores.map((row) => row.score));
  const dimensionAvg = avg(Object.values(input.dimensions));
  const opportunityScore = Math.max(0, Math.min(100, laneAvg * 0.55 + dimensionAvg * 0.35 + input.healthDataQuality * 0.1));
  const topLane = [...input.laneScores].sort((a, b) => b.score - a.score)[0];
  const spread = Math.max(...input.laneScores.map((row) => row.score)) - Math.min(...input.laneScores.map((row) => row.score));
  const confidence = Math.max(0, Math.min(100, opportunityScore * 0.7 + (100 - spread) * 0.3));
  return {
    opportunityScore,
    confidence,
    laneLeader: topLane?.lane ?? "MOMENTUM",
  };
}

export function rankDiscoveryProfiles(profiles: DiscoveryProfileOutput[]) {
  return [...profiles]
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .map((profile, index) => ({
      symbol: profile.symbol,
      rank: index + 1,
      tier: profile.tier,
      opportunityScore: profile.opportunityScore,
      laneLeader: profile.laneScores.sort((a, b) => b.score - a.score)[0]?.lane,
    }));
}

export function tierFromScore(score: number): DiscoveryTier {
  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "D";
}
