import type { PositionCloseReason } from "@/src/server/execution/types";
import { resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";
import { resolveRegimeAwareEntryQualityThreshold } from "@/src/server/scanner/regime-intelligence.service";

export const MINIMUM_NET_EXIT_PROFIT_PERCENT = 0.45;
const PROFIT_BUFFER_AFTER_FEES_PERCENT = 0.05;

/** Trade quality policy — entry/exit calibration for profit factor (not global risk relax). */
export const TRADE_QUALITY_POLICY = {
  maxAiRiskScoreWithoutEliteConfidence: 75,
  minConfidenceForHighRiskEntry: 82,
  trendingTpConfidenceBoost: 0.12,
  minConfidenceForTrendingTpBoost: 75,
  minRewardRiskForQualityTimeoutExit: 1.3,
  minConfidenceForQualityTimeoutExit: 70,
} as const;

export function shouldRejectHighRiskLowConfidenceEntry(input: {
  confidencePercent: number;
  aiRiskScore: number;
  marketRegime?: string;
}): { reject: boolean; reason?: string } {
  const thresholds = resolveRegimeAwareEntryQualityThreshold({
    marketRegime: input.marketRegime ?? "RANGE_SIDEWAYS",
    baseMaxAiRiskScore: TRADE_QUALITY_POLICY.maxAiRiskScoreWithoutEliteConfidence,
    baseMinConfidence: TRADE_QUALITY_POLICY.minConfidenceForHighRiskEntry,
  });
  if (input.aiRiskScore > thresholds.maxAiRiskScore && input.confidencePercent < thresholds.minConfidence) {
    return {
      reject: true,
      reason: `ENTRY_QUALITY:AI_RISK_ELEVATED_LOW_CONFIDENCE elevated AI risk (${input.aiRiskScore.toFixed(0)}) without elite confidence (${input.confidencePercent.toFixed(0)}% < ${thresholds.minConfidence.toFixed(0)}%)`,
    };
  }
  return { reject: false };
}

export function resolveRegimeTakeProfitBoost(input: {
  marketRegime: string;
  confidencePercent: number;
}): number {
  const regime = input.marketRegime.toUpperCase();
  if (
    (regime.includes("BULL") || regime.includes("ROCKET") || regime.includes("TREND")) &&
    input.confidencePercent >= TRADE_QUALITY_POLICY.minConfidenceForTrendingTpBoost
  ) {
    return TRADE_QUALITY_POLICY.trendingTpConfidenceBoost;
  }
  if (regime.includes("RANGE") || regime.includes("SIDEWAYS") || regime.includes("LOW_VOL")) {
    return input.confidencePercent >= 75 ? 0.06 : 0;
  }
  return 0;
}

export function resolveMinimumProtectedProfitPercent() {
  const roundTripFeePercent = resolveRoundTripTakerFeePercent();
  return Number((roundTripFeePercent + MINIMUM_NET_EXIT_PROFIT_PERCENT + PROFIT_BUFFER_AFTER_FEES_PERCENT).toFixed(4));
}

export function calculateNetProfitPercent(input: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  exitPrice: number;
}) {
  const grossProfitPercent = calculatePositionProfitPercent({
    side: input.side,
    entryPrice: input.entryPrice,
    markPrice: input.exitPrice,
  });
  return Number((grossProfitPercent - resolveRoundTripTakerFeePercent()).toFixed(4));
}

export function isSuccessfulNetExit(roePercent: number | null | undefined) {
  const value = Number(roePercent ?? 0);
  return Number.isFinite(value) && value >= MINIMUM_NET_EXIT_PROFIT_PERCENT;
}

export function classifyNetExitOutcome(roePercent: number | null | undefined): "WIN" | "LOSS" | "BREAKEVEN" {
  const value = Number(roePercent ?? 0);
  if (isSuccessfulNetExit(value)) return "WIN";
  if (value < 0) return "LOSS";
  return "BREAKEVEN";
}

export function calculatePositionProfitPercent(input: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
}) {
  const entryPrice = Number(input.entryPrice);
  const markPrice = Number(input.markPrice);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(markPrice) || markPrice <= 0) {
    return 0;
  }
  const raw =
    input.side === "LONG"
      ? ((markPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - markPrice) / entryPrice) * 100;
  return Number.isFinite(raw) ? raw : 0;
}

export function isProtectedProfitCloseReason(reason: PositionCloseReason | null | undefined) {
  return reason === "MOMENTUM_FADE" || reason === "REVERSE_SIGNAL" || reason === "EARLY_PROFIT_PROTECT" || reason === "TRAILING_PROFIT_LOCK";
}

