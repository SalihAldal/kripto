import type { ExitDecision, ExitDecisionKind, ExitPolicyState } from "@/src/server/profitability/pr04-types";
import { getExitPolicyDefinition } from "@/src/server/profitability/pr04-policy-registry";

const PRIORITY: ExitDecisionKind[] = [
  "RISK_OVERRIDE",
  "STRUCTURAL_STOP",
  "TAKE_PROFIT",
  "PARTIAL_TAKE_PROFIT",
  "TRAILING_STOP",
  "TIME_EXIT",
  "SETUP_INVALIDATION",
  "NONE",
];

export function pickHighestPriorityDecision(candidates: ExitDecision[]): ExitDecision {
  const actionable = candidates.filter((c) => c.kind !== "NONE");
  if (!actionable.length) {
    return candidates[0] ?? noneDecision();
  }
  actionable.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  return actionable[0]!;
}

export function shouldSuppressDuplicateExit(input: {
  state: ExitPolicyState;
  decision: ExitDecision;
}) {
  if (input.decision.reasonCode === "DUPLICATE_EVENT_SUPPRESSED") return false;
  const hasOpenExitOrder =
    input.state.reservedSellQuantity > 0 &&
    (input.state.orderState === "SUBMITTED" || input.state.orderState === "PARTIALLY_FILLED");
  if (hasOpenExitOrder) {
    return input.decision.kind !== "RISK_OVERRIDE";
  }
  return false;
}

export function registerOpenExitOrder(input: {
  state: ExitPolicyState;
  intentId: string;
  requestedQuantity: number;
  partialLegId?: string | null;
}) {
  input.state.activeExitOrder = {
    intentId: input.intentId,
    requestedQuantity: input.requestedQuantity,
    executedQuantity: 0,
    openQuantity: input.requestedQuantity,
    partialLegId: input.partialLegId ?? null,
    terminal: false,
  };
  input.state.reservedSellQuantity = input.requestedQuantity;
  input.state.orderState = "SUBMITTED";
}

export function releaseCompletedExitOrder(input: {
  state: ExitPolicyState;
  filledQuantity: number;
  openOrderRemainingQuantity?: number;
}) {
  const openRemaining = input.openOrderRemainingQuantity ?? 0;
  if (openRemaining > 0) {
    input.state.reservedSellQuantity = openRemaining;
    input.state.orderState = "PARTIALLY_FILLED";
    if (input.state.activeExitOrder) {
      input.state.activeExitOrder.executedQuantity += input.filledQuantity;
      input.state.activeExitOrder.openQuantity = openRemaining;
      input.state.activeExitOrder.terminal = false;
    }
    return;
  }
  input.state.reservedSellQuantity = Math.max(0, input.state.reservedSellQuantity - input.filledQuantity);
  input.state.orderState = input.state.remainingQuantity <= 0 ? "FILLED" : "NONE";
  input.state.activeExitOrder = null;
}

export function claimExitQuantity(input: {
  state: ExitPolicyState;
  quantity: number;
}) {
  if (input.quantity <= 0) return { claimed: false, reasonCode: "ZERO_QUANTITY" };
  if (input.state.reservedSellQuantity + input.quantity > input.state.remainingQuantity) {
    return { claimed: false, reasonCode: "SELL_EXCEEDS_REMAINING" };
  }
  return { claimed: true, reasonCode: "CLAIMED" };
}

function noneDecision(): ExitDecision {
  return {
    kind: "NONE",
    reasonCode: "NO_EXIT",
    decisionAtMs: Date.now(),
    availableAtMs: Date.now(),
    closeQuantity: null,
    decisionPrice: null,
    stopPriceAfter: null,
    partialLegId: null,
    duplicateSuppressed: false,
    policyId: "BASELINE_FIXED_TP_SL",
  };
}

export function resolvePolicyPriority(policyId: ExitDecision["policyId"]) {
  return getExitPolicyDefinition(policyId).priorityOrder;
}
