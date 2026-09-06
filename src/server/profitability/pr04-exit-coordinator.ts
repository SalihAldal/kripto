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
  if (input.state.orderState === "SUBMITTED" || input.state.orderState === "PARTIALLY_FILLED") {
    return input.decision.kind !== "RISK_OVERRIDE";
  }
  return false;
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
