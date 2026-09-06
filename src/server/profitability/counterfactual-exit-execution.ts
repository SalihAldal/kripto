import type { ExitDecisionKind, ExitTickObservation } from "@/src/server/profitability/pr04-types";

/**
 * Deterministic counterfactual exit execution model (engineering-only).
 *
 * Assumptions:
 * - Fills occur only after actionable exit + configured latency.
 * - Quotes must be available at or before fill time (no future availableAt).
 * - Partial fills are quantity-capped to the open order request.
 * - Stop fills route through the active open order, not a fresh decision tick.
 * - Open positions at window end are censored (no synthetic terminal fill).
 */
export type CounterfactualExitOrderIntent = {
  decisionKind: ExitDecisionKind;
  partialLegId: string | null;
  requestedQuantity: number;
  openedAtMs: number;
};

export type CounterfactualExitFillPlan = {
  price: number;
  quantity: number;
  fee: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
  fillAtMs: number;
  decisionKind: ExitDecisionKind;
  partialLegId: string | null;
};

export type CounterfactualExitTickInput = {
  observation: ExitTickObservation;
  decisionKind: ExitDecisionKind;
  closeQuantity: number | null;
  partialLegId: string | null;
  quotePrice: number | null;
  latencyMs: number;
  feeRate: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
};

export function isActionableExitDecision(kind: ExitDecisionKind, closeQuantity: number | null) {
  return kind !== "NONE" && closeQuantity != null && closeQuantity > 0;
}

export function planCounterfactualExitTick(input: CounterfactualExitTickInput & { openOrder: CounterfactualExitOrderIntent | null }) {
  const actionable = isActionableExitDecision(input.decisionKind, input.closeQuantity);
  let openOrder = input.openOrder;
  if (actionable) {
    openOrder = {
      decisionKind: input.decisionKind,
      partialLegId: input.partialLegId,
      requestedQuantity: input.closeQuantity!,
      openedAtMs: input.observation.eventAtMs,
    };
  }
  if (!openOrder) {
    return { openOrder: null, fill: null as CounterfactualExitFillPlan | null, censored: false };
  }
  const earliestFillAt = openOrder.openedAtMs + Math.max(0, input.latencyMs);
  if (input.observation.availableAtMs > input.observation.eventAtMs) {
    return { openOrder, fill: null, censored: false, rejectedReason: "QUOTE_NOT_YET_AVAILABLE" };
  }
  if (input.observation.eventAtMs < earliestFillAt) {
    return { openOrder, fill: null, censored: false, rejectedReason: "LATENCY_NOT_ELAPSED" };
  }
  if (input.quotePrice == null || !Number.isFinite(input.quotePrice) || input.quotePrice <= 0) {
    return { openOrder, fill: null, censored: false, rejectedReason: "NO_QUOTE" };
  }
  const quantity = Math.min(openOrder.requestedQuantity, input.closeQuantity ?? openOrder.requestedQuantity);
  const fee = Number((quantity * input.quotePrice * input.feeRate).toFixed(8));
  const fill: CounterfactualExitFillPlan = {
    price: input.quotePrice,
    quantity,
    fee,
    feeAsset: input.feeAsset,
    fillAtMs: Math.max(input.observation.eventAtMs, earliestFillAt),
    decisionKind: openOrder.decisionKind,
    partialLegId: openOrder.partialLegId,
  };
  const remaining = openOrder.requestedQuantity - quantity;
  const nextOpenOrder =
    remaining > 1e-8
      ? { ...openOrder, requestedQuantity: remaining, openedAtMs: fill.fillAtMs }
      : null;
  return { openOrder: nextOpenOrder, fill, censored: false };
}

export function censorOpenCounterfactualPosition(openOrder: CounterfactualExitOrderIntent | null, windowEndMs: number) {
  if (!openOrder) return { censored: false, openOrder: null };
  return { censored: true, openOrder: null, censoredAtMs: windowEndMs };
}
