import { calculateValidQuantity, validateSymbolFilters } from "@/services/binance.service";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";

export async function validateExchangeSafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const filter = await validateSymbolFilters(input.symbol, input.quantity, input.priceHint);
  const reasons = filter.ok ? [] : [...filter.reasons];
  return {
    stage: "EXCHANGE",
    passed: filter.ok,
    reasons,
    metadata: {
      adjustedQuantity: filter.adjustedQuantity,
      adjustedPrice: filter.adjustedPrice,
      minNotional: filter.minNotional,
    },
  };
}

export async function validateQuantitySafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    reasons.push("Invalid quantity");
  }
  const validQty = await calculateValidQuantity(input.symbol, input.quantity).catch(() => input.quantity);
  if (Math.abs(validQty - input.quantity) > 1e-8 && validQty <= 0) {
    reasons.push("Quantity fails step size / lot size");
  }
  return {
    stage: "QUANTITY",
    passed: reasons.length === 0,
    reasons,
    metadata: { requestedQty: input.quantity, validQty },
  };
}

export async function validateOrderSafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  if (!input.executionId) reasons.push("Missing execution UUID");
  if (!["BUY", "SELL"].includes(input.side)) reasons.push("Invalid order side");
  if (!input.symbol) reasons.push("Invalid symbol");
  return {
    stage: "ORDER",
    passed: reasons.length === 0,
    reasons,
    metadata: { orderType: input.orderType ?? "MARKET" },
  };
}

export function evaluateSafetyRules(stages: SafetyValidationStageResult[]) {
  const failed = stages.filter((stage) => !stage.passed);
  const rejectReasons = failed.flatMap((stage) => stage.reasons);
  return {
    passed: failed.length === 0,
    rejectReason: rejectReasons.join(", ") || undefined,
    blockedBy: failed[0]?.stage,
    rejectReasons,
  };
}
