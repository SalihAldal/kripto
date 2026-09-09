import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { RiskReference } from "@/src/server/profitability/pr04-types";

export function resolveStructuralStopFromInvalidation(input: {
  strategyId: StrategyId;
  side: "LONG" | "SHORT";
  entryPrice: number;
  invalidation: InvalidationContract | null;
  tickSize: number;
}): { stopPrice: number | null; reasonCode: string; quality: "VALID" | "UNKNOWN" } {
  if (!input.invalidation || input.invalidation.invalidationThreshold == null) {
    return { stopPrice: null, reasonCode: "INVALIDATION_MISSING", quality: "UNKNOWN" };
  }
  const threshold = input.invalidation.invalidationThreshold;
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { stopPrice: null, reasonCode: "INVALIDATION_THRESHOLD_INVALID", quality: "UNKNOWN" };
  }
  if (input.side === "LONG" && threshold >= input.entryPrice) {
    return { stopPrice: null, reasonCode: "STOP_WRONG_SIDE_FOR_LONG", quality: "UNKNOWN" };
  }
  if (input.side === "SHORT" && threshold <= input.entryPrice) {
    return { stopPrice: null, reasonCode: "STOP_WRONG_SIDE_FOR_SHORT", quality: "UNKNOWN" };
  }
  const rounded = roundToTick(threshold, input.tickSize, input.side === "LONG" ? "down" : "up");
  return { stopPrice: rounded, reasonCode: input.invalidation.reasonCode, quality: "VALID" };
}

export function buildRiskReference(input: {
  entryPrice: number;
  initialStopPrice: number | null;
  initialQuantity: number;
  entryFee: number;
  includesFeesInBreakEven: boolean;
  computedAtMs: number;
}): RiskReference {
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) {
    return {
      entryPrice: input.entryPrice,
      initialStopPrice: input.initialStopPrice,
      initialRiskPerUnit: null,
      initialRiskNotional: null,
      includesFeesInBreakEven: input.includesFeesInBreakEven,
      computedAtMs: input.computedAtMs,
      quality: "INSUFFICIENT_DATA",
      reasonCode: "ENTRY_PRICE_INVALID",
    };
  }
  const stop = input.initialStopPrice;
  if (!Number.isFinite(input.initialQuantity) || input.initialQuantity <= 0 || !Number.isFinite(input.entryFee) || input.entryFee < 0) {
    return { entryPrice: input.entryPrice, initialStopPrice: stop, initialRiskPerUnit: null, initialRiskNotional: null,
      includesFeesInBreakEven: input.includesFeesInBreakEven, computedAtMs: input.computedAtMs, quality: "INSUFFICIENT_DATA", reasonCode: "QUANTITY_OR_FEE_INVALID" };
  }
  if (stop == null || !Number.isFinite(stop)) {
    return {
      entryPrice: input.entryPrice,
      initialStopPrice: null,
      initialRiskPerUnit: null,
      initialRiskNotional: null,
      includesFeesInBreakEven: input.includesFeesInBreakEven,
      computedAtMs: input.computedAtMs,
      quality: "UNKNOWN",
      reasonCode: "STOP_NOT_DEFINED",
    };
  }
  const riskPerUnit = Math.abs(input.entryPrice - stop);
  if (riskPerUnit <= 0) {
    return {
      entryPrice: input.entryPrice,
      initialStopPrice: stop,
      initialRiskPerUnit: null,
      initialRiskNotional: null,
      includesFeesInBreakEven: input.includesFeesInBreakEven,
      computedAtMs: input.computedAtMs,
      quality: "UNKNOWN",
      reasonCode: "ZERO_RISK_DISTANCE",
    };
  }
  const feePerUnit =
    input.includesFeesInBreakEven && input.initialQuantity > 0
      ? input.entryFee / input.initialQuantity
      : 0;
  // Entry fees increase the amount lost at the stop. They cannot reduce risk.
  // Future exit fee/slippage are not supplied by this legacy contract.
  const adjustedRiskPerUnit = riskPerUnit + feePerUnit;
  const notional = adjustedRiskPerUnit * input.initialQuantity;
  return {
    entryPrice: input.entryPrice,
    initialStopPrice: stop,
    initialRiskPerUnit: adjustedRiskPerUnit,
    initialRiskNotional: Number.isFinite(notional) ? notional : null,
    includesFeesInBreakEven: input.includesFeesInBreakEven,
    computedAtMs: input.computedAtMs,
    quality: adjustedRiskPerUnit > 0 ? "VALID" : "UNKNOWN",
    reasonCode: adjustedRiskPerUnit > 0 ? null : "ZERO_RISK_AFTER_FEES",
  };
}

export function computeRMultiple(input: {
  riskReference: RiskReference;
  realizedNetPnl: number | null;
}): number | null {
  if (input.riskReference.quality !== "VALID" || input.riskReference.initialRiskNotional == null) return null;
  if (input.riskReference.initialRiskNotional <= 0) return null;
  if (input.realizedNetPnl == null || !Number.isFinite(input.realizedNetPnl)) return null;
  return Number((input.realizedNetPnl / input.riskReference.initialRiskNotional).toFixed(6));
}

function roundToTick(value: number, tickSize: number, direction: "up" | "down") {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return value;
  const steps = value / tickSize;
  const rounded = direction === "down" ? Math.floor(steps) : Math.ceil(steps);
  return Number((rounded * tickSize).toFixed(8));
}
