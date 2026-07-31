import type { DiscoveryRegime, DiscoveryTier } from "@prisma/client";
import type { DiscoveryProfileOutput, DiscoveryTradeType } from "@/src/server/discovery/discovery.types";
import { tierFromScore } from "@/src/server/discovery/master-scanner.service";

function inferTradeTypes(profile: Omit<DiscoveryProfileOutput, "tradeTypes" | "tier">): DiscoveryTradeType[] {
  const types = new Set<DiscoveryTradeType>();
  const topLane = [...profile.laneScores].sort((a, b) => b.score - a.score)[0]?.lane;

  types.add("SPOT");
  if (profile.dimensions.breakout >= 60 || topLane === "BREAKOUT") types.add("BREAKOUT");
  if (profile.dimensions.momentum >= 60 || topLane === "MOMENTUM") types.add("MOMENTUM");
  if (profile.dimensions.volatility >= 65) types.add("SCALP");
  if (profile.dimensions.trend >= 55) types.add("SWING");
  if (profile.opportunityScore >= 75 && profile.dimensions.risk <= 45) types.add("POSITION");
  if (profile.assetClass === "LAYER1" || profile.assetClass === "ETF_RELATED") types.add("INVESTMENT");

  return Array.from(types);
}

function buildSummary(symbol: string, regime: DiscoveryRegime, opportunityScore: number, laneLeader?: string) {
  return `${symbol} discovery score ${opportunityScore.toFixed(1)} | regime=${regime} | lead=${laneLeader ?? "N/A"}`;
}

export function assignOpportunityTier(profile: Omit<DiscoveryProfileOutput, "tier">): DiscoveryTier {
  return tierFromScore(profile.opportunityScore);
}

export function buildDiscoveryOutput(input: Omit<DiscoveryProfileOutput, "tier" | "tradeTypes" | "summary">): DiscoveryProfileOutput {
  const tier = assignOpportunityTier({ ...input, tier: "D" } as DiscoveryProfileOutput);
  const laneLeader = [...input.laneScores].sort((a, b) => b.score - a.score)[0]?.lane;
  const positiveFactors = input.laneScores
    .filter((row) => row.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((row) => `${row.lane}:${row.score.toFixed(0)}`);
  const negativeFactors = input.laneScores
    .filter((row) => row.score < 35)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((row) => `${row.lane}:${row.score.toFixed(0)}`);

  return {
    ...input,
    tier,
    tradeTypes: inferTradeTypes({ ...input, tier } as DiscoveryProfileOutput),
    summary: buildSummary(input.symbol, input.regime, input.opportunityScore, laneLeader),
    positiveFactors,
    negativeFactors,
  };
}
