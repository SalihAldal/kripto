import type { StrategyScore, StrategySelectionResult, StrategyConfidenceResult } from "@/src/server/strategy-selector/strategy-selector.types";
import type { StrategySelectorType } from "@prisma/client";
import { getStrategyProfile } from "@/src/server/strategy-selector/strategy-library.service";

export function selectStrategy(rankings: StrategyScore[], regimeLabel: string, coinClass: string): StrategySelectionResult {
  const primary = rankings[0]!;
  const secondary = rankings[1] ?? null;
  const rejected = rankings.slice(2).map((r) => r.strategyType);

  const reasoningSummary =
    `Primary: ${primary.strategyType} (score ${primary.totalScore}, confidence ${primary.confidence}) ` +
    `for ${regimeLabel} regime / ${coinClass} coin. ` +
    `${secondary ? `Secondary: ${secondary.strategyType}. ` : ""}` +
    `Rejected: ${rejected.slice(0, 5).join(", ") || "none"}.`;

  return {
    primaryStrategy: primary.strategyType,
    secondaryStrategy: secondary?.strategyType ?? null,
    rejectedStrategies: rejected,
    reasoningSummary,
    rankings,
  };
}

export function computeStrategyConfidence(primary: StrategyScore): StrategyConfidenceResult {
  const profile = getStrategyProfile(primary.strategyType);
  const holdMap: Partial<Record<StrategySelectorType, number>> = {
    SCALP: 30, MOMENTUM: 120, BREAKOUT: 180, SWING: 1440, TREND_FOLLOWING: 720,
    CONSERVATIVE: 480, AGGRESSIVE: 60, NEWS: 90, WHALE: 240,
  };

  return {
    strategyConfidence: primary.confidence,
    expectedSuccess: Number((primary.expectedWinRate * 0.7 + primary.confidence * 0.3).toFixed(1)),
    expectedRisk: Number((100 - primary.marketCompatibility).toFixed(1)),
    expectedHoldMinutes: holdMap[primary.strategyType] ?? 240,
    expectedVolatility: profile?.riskThreshold ?? 50,
  };
}
