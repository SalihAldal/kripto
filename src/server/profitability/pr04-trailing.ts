import type { ExitPolicyState } from "@/src/server/profitability/pr04-types";

export type TrailingUpdateResult = {
  armed: boolean;
  highWaterMark: number | null;
  stopPrice: number | null;
  updated: boolean;
  reasonCode: string;
  duplicateSuppressed: boolean;
};

export function updateCausalTrailing(input: {
  state: ExitPolicyState;
  side: "LONG" | "SHORT";
  markPrice: number;
  observationHigh: number | null;
  observationLow: number | null;
  activationPct: number;
  gapPct: number;
  eventId: string;
  lastProcessedEventId: string | null;
}): TrailingUpdateResult {
  if (input.side !== "LONG") {
    return {
      armed: input.state.trailingArmed,
      highWaterMark: input.state.trailingHighWaterMark,
      stopPrice: input.state.activeStopPrice,
      updated: false,
      reasonCode: "TRAILING_LONG_ONLY",
      duplicateSuppressed: false,
    };
  }
  if (input.lastProcessedEventId === input.eventId) {
    return {
      armed: input.state.trailingArmed,
      highWaterMark: input.state.trailingHighWaterMark,
      stopPrice: input.state.activeStopPrice,
      updated: false,
      reasonCode: "DUPLICATE_EVENT_SUPPRESSED",
      duplicateSuppressed: true,
    };
  }
  const entry = input.state.riskReference.entryPrice;
  const progressPct = entry > 0 ? ((input.markPrice - entry) / entry) * 100 : 0;
  const candidateHigh =
    input.observationHigh != null && input.observationHigh > input.markPrice
      ? input.observationHigh
      : input.markPrice;
  let highWater = input.state.trailingHighWaterMark ?? entry;
  if (candidateHigh > highWater) highWater = candidateHigh;
  const armed = input.state.trailingArmed || progressPct >= input.activationPct;
  if (!armed) {
    return {
      armed: false,
      highWaterMark: highWater,
      stopPrice: input.state.activeStopPrice,
      updated: highWater !== input.state.trailingHighWaterMark,
      reasonCode: "TRAILING_NOT_ARMED",
      duplicateSuppressed: false,
    };
  }
  const trailStop = highWater * (1 - input.gapPct / 100);
  const currentStop = input.state.activeStopPrice ?? 0;
  const nextStop = Math.max(currentStop, trailStop);
  if (nextStop <= input.markPrice) {
    return {
      armed: true,
      highWaterMark: highWater,
      stopPrice: nextStop,
      updated: nextStop !== currentStop,
      reasonCode: nextStop > currentStop ? "TRAILING_STOP_RAISED" : "TRAILING_UNCHANGED",
      duplicateSuppressed: false,
    };
  }
  return {
    armed: true,
    highWaterMark: highWater,
    stopPrice: nextStop,
    updated: nextStop !== currentStop,
    reasonCode: "TRAILING_STOP_ABOVE_MARK",
    duplicateSuppressed: false,
  };
}

export function isTrailingStopHit(input: {
  side: "LONG" | "SHORT";
  markPrice: number;
  stopPrice: number | null;
}) {
  if (input.stopPrice == null) return false;
  if (input.side === "LONG") return input.markPrice <= input.stopPrice;
  return input.markPrice >= input.stopPrice;
}
