import type { DiscoveryBatchInput, DiscoveryBatchResult, DiscoveryProfileOutput } from "@/src/server/discovery/discovery.types";
import { scoreAllDiscoveryLanes } from "@/src/server/discovery/lanes/discovery-lanes.engine";
import {
  buildScannerProfileDimensions,
  mergeMasterScannerScore,
  rankDiscoveryProfiles,
} from "@/src/server/discovery/master-scanner.service";
import { buildDiscoveryOutput } from "@/src/server/discovery/opportunity-tier.service";
import { classifyAsset } from "@/src/server/discovery/stages/market-classification.service";
import { filterHealthyOnly } from "@/src/server/discovery/stages/market-health-filter.service";
import { detectDiscoveryRegime, regimeConfidence } from "@/src/server/discovery/stages/regime-detection.service";
import { persistDiscoveryBatch } from "@/src/server/discovery/discovery.repository";
import { emitDiscoveryEvent } from "@/src/server/discovery/discovery.events";

export async function runDiscoveryForSymbol(input: DiscoveryBatchInput): Promise<DiscoveryProfileOutput | null> {
  if (!input.context) return null;
  const healthyRows = filterHealthyOnly([{ symbol: input.symbol, context: input.context }]);
  if (healthyRows.length === 0) return null;

  const assetClass = classifyAsset({
    symbol: input.symbol,
    context: input.context,
    universeMeta: input.universeMeta,
  });
  const regime = detectDiscoveryRegime(input.context);
  const laneScores = scoreAllDiscoveryLanes({
    context: input.context,
    assetClass,
    universeMeta: input.universeMeta,
  });
  const dimensions = buildScannerProfileDimensions(laneScores);
  const merged = mergeMasterScannerScore({
    laneScores,
    dimensions,
    healthDataQuality: healthyRows[0].health.dataQualityScore,
  });

  return buildDiscoveryOutput({
    symbol: input.symbol,
    assetClass,
    regime,
    opportunityScore: merged.opportunityScore,
    confidence: Math.max(merged.confidence, regimeConfidence(input.context, regime)),
    positiveFactors: [],
    negativeFactors: [],
    dimensions,
    laneScores,
    profile: {
      regime,
      assetClass,
      laneLeader: merged.laneLeader,
      health: healthyRows[0].health,
      metadata: input.context.metadata,
    },
    health: healthyRows[0].health,
  });
}

export async function runDiscoveryBatch(
  inputs: DiscoveryBatchInput[],
  options?: { persist?: boolean },
): Promise<DiscoveryBatchResult> {
  const scannedAt = new Date().toISOString();
  const profiles: DiscoveryProfileOutput[] = [];

  for (const input of inputs) {
    const profile = await runDiscoveryForSymbol(input);
    if (profile) profiles.push(profile);
  }

  const rankings = rankDiscoveryProfiles(profiles);
  if (options?.persist !== false && profiles.length > 0) {
    await persistDiscoveryBatch({ scannedAt, profiles, rankings }).catch(() => null);
    emitDiscoveryEvent("discovery.batch.completed", { scannedAt, count: profiles.length });
  }

  return {
    scannedAt,
    totalSymbols: inputs.length,
    healthySymbols: profiles.length,
    profiles,
    rankings,
  };
}

export function discoveryProfilesToCandidateRank<T extends { context: { symbol: string }; score: { score: number } }>(
  rows: T[],
  profiles: DiscoveryProfileOutput[],
): T[] {
  const profileMap = new Map(profiles.map((row) => [row.symbol.toUpperCase(), row]));
  return [...rows].sort((a, b) => {
    const aProfile = profileMap.get(a.context.symbol.toUpperCase());
    const bProfile = profileMap.get(b.context.symbol.toUpperCase());
    const aScore = aProfile?.opportunityScore ?? a.score.score;
    const bScore = bProfile?.opportunityScore ?? b.score.score;
    return bScore - aScore;
  });
}
