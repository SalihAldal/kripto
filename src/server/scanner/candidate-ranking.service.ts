import type { MarketContext, ScannerCandidate, ScannerScore } from "@/src/types/scanner";
import { resolveRegimePipelinePolicy } from "@/src/server/scanner/regime-intelligence.service";

/** Stable ranking policy contract for scanner/discovery consumers. */
export const RANKING_LOGIC_POLICY = {
  scannerRankingPrimary: true,
  discoveryV2BoostWhenIntegrated: true,
  topGainerPriorityBoostEnabled: true,
  preAiRankingRequired: true,
  /** Base minimum composite ranking score before execution consideration. */
  baseRankingThreshold: 55,
  /** Relaxed floor for high-confidence, low-risk setups (false-negative calibration). */
  highConfidenceRankingFloor: 48,
  minConfidenceForRankingRelief: 65,
  maxRiskScoreForRankingRelief: 50,
} as const;

/** Regime-aware ranking threshold — uses detectMarketRegime entryThresholdScore when available. */
export function resolveRankingThreshold(input: {
  confidencePercent: number;
  riskScore: number;
  marketRegime?: string;
  entryThresholdScore?: number;
  volatilityPercent?: number;
  liquidity24h?: number;
}): number {
  const regimePolicy = resolveRegimePipelinePolicy({
    marketRegime: input.marketRegime ?? "RANGE_SIDEWAYS",
    entryThresholdScore: input.entryThresholdScore,
    volatilityPercent: input.volatilityPercent,
    liquidity24h: input.liquidity24h,
  });
  let threshold = regimePolicy.rankingThreshold;
  if (
    input.confidencePercent >= RANKING_LOGIC_POLICY.minConfidenceForRankingRelief &&
    input.riskScore <= RANKING_LOGIC_POLICY.maxRiskScoreForRankingRelief
  ) {
    threshold = Math.min(threshold, RANKING_LOGIC_POLICY.highConfidenceRankingFloor);
  }
  return threshold;
}

export function evaluateRankingGate(input: {
  rankingScore: number;
  confidencePercent: number;
  riskScore: number;
  marketRegime?: string;
  entryThresholdScore?: number;
  volatilityPercent?: number;
  liquidity24h?: number;
}): { pass: boolean; threshold: number; reason?: string } {
  const threshold = resolveRankingThreshold(input);
  const pass = input.rankingScore >= threshold;
  return {
    pass,
    threshold,
    reason: pass
      ? undefined
      : `Ranking below threshold (${input.rankingScore} < ${threshold})`,
  };
}

export function rankCandidates(
  rows: Array<{ context: MarketContext; score: ScannerScore }>,
  topN: number,
): ScannerCandidate[] {
  return rows
    .sort((a, b) => {
      const aBoost = Number(a.context.metadata.topGainerPriorityScore ?? 0) * 0.18;
      const bBoost = Number(b.context.metadata.topGainerPriorityScore ?? 0) * 0.18;
      return (b.score.score + bBoost) - (a.score.score + aBoost);
    })
    .slice(0, topN)
    .map((row, index) => ({
      rank: index + 1,
      context: row.context,
      score: row.score,
    }));
}
