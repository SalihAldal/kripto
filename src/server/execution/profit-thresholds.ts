import type { PositionCloseReason } from "@/src/server/execution/types";
import { resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";

export const MINIMUM_NET_EXIT_PROFIT_PERCENT = 0.45;
const PROFIT_BUFFER_AFTER_FEES_PERCENT = 0.05;

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

