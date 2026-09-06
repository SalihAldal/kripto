import type { PositionCloseReason, TradingMode } from "@/src/server/execution/types";
import { settleOpenPosition } from "@/src/server/execution/post-trade-settlement.service";
import {
  loadPersistedExitBundle,
  savePersistedExitState,
  syncExitStateToDb,
} from "@/src/server/execution/fix02-exit-persistence.service";
import { claimExitQuantity, registerOpenExitOrder } from "@/src/server/profitability/pr04-exit-coordinator";
import {
  evaluateExitPolicyTick,
  getExitPolicyState,
  hydrateExitPolicyState,
} from "@/src/server/profitability/pr04-exit-evaluator";
import {
  isPr04ExitEvaluationEnabled,
  isPr04ExitRoutingEnabled,
} from "@/src/server/profitability/pr04-exit-bridge";
import type { ExitDecisionKind, ExitTickObservation } from "@/src/server/profitability/pr04-types";
import { createHash } from "node:crypto";
import {
  isSuccessfulSettlementFill,
  requireSettlementFillEvidence,
  type SettlementFillResult,
} from "@/src/server/execution/settlement-fill-result";

export type Fix02ExitTickInput = {
  executionId: string;
  positionId: string;
  userId: string;
  side: "LONG" | "SHORT";
  mode: TradingMode;
  observation: ExitTickObservation;
  riskOverride?: boolean;
};

export type Fix02ExitTickResult = {
  handled: boolean;
  authorityActive: boolean;
  decisionKind: ExitDecisionKind | "NONE";
  closed: boolean;
  partial: boolean;
  reasonCode: string | null;
  remainingQuantity: number | null;
  reconciliationRequired: boolean;
};

export async function isFix02Pr04ExitAuthority(positionId: string) {
  if (!isPr04ExitRoutingEnabled()) return false;
  const bundle = await loadPersistedExitBundle(positionId);
  if (bundle) return true;
  const state = getExitPolicyState(positionId);
  return Boolean(state?.snapshot.experimentalMode);
}

function mapDecisionToCloseReason(kind: ExitDecisionKind): PositionCloseReason {
  switch (kind) {
    case "STRUCTURAL_STOP":
      return "STOP_LOSS";
    case "TAKE_PROFIT":
    case "PARTIAL_TAKE_PROFIT":
      return "TAKE_PROFIT";
    case "TRAILING_STOP":
      return "TRAILING_PROFIT_LOCK";
    case "TIME_EXIT":
      return "TIMEOUT";
    case "RISK_OVERRIDE":
      return "RISK_BREAKER";
    case "SETUP_INVALIDATION":
      return "REVERSE_SIGNAL";
    default:
      return "MANUAL_CLOSE";
  }
}

function isActionableDecision(kind: ExitDecisionKind) {
  return kind !== "NONE";
}

function buildExitIntentId(input: {
  positionId: string;
  decisionKind: ExitDecisionKind;
  quantity: number;
  eventId: string;
  partialLegId?: string | null;
}) {
  return createHash("sha256")
    .update(`${input.positionId}:${input.decisionKind}:${input.quantity}:${input.eventId}:${input.partialLegId ?? ""}`)
    .digest("hex")
    .slice(0, 24);
}

export async function processFix02Pr04ExitTick(input: Fix02ExitTickInput): Promise<Fix02ExitTickResult> {
  const authorityActive = await isFix02Pr04ExitAuthority(input.positionId);
  if (!authorityActive) {
    return {
      handled: false,
      authorityActive: false,
      decisionKind: "NONE",
      closed: false,
      partial: false,
      reasonCode: null,
      remainingQuantity: null,
      reconciliationRequired: false,
    };
  }

  const bundle = await loadPersistedExitBundle(input.positionId);
  if (bundle && !getExitPolicyState(input.positionId)) {
    hydrateExitPolicyState(bundle.state);
  }
  if (bundle && bundle.reconciliationStatus === "RECONCILE_REQUIRED") {
    return {
      handled: true,
      authorityActive: true,
      decisionKind: "NONE",
      closed: false,
      partial: false,
      reasonCode: "RECONCILE_REQUIRED",
      remainingQuantity: bundle.state.remainingQuantity,
      reconciliationRequired: true,
    };
  }

  const evaluation = evaluateExitPolicyTick({
    positionId: input.positionId,
    side: input.side,
    observation: input.observation,
    riskOverride: input.riskOverride,
  });
  const decision = evaluation.decision;
  if (bundle) {
    try {
      await savePersistedExitState({
        positionId: input.positionId,
        expectedVersion: bundle.stateVersion,
        state: evaluation.state,
        processedFillIds: bundle.processedFillIds,
        activeExitIntentId: bundle.activeExitIntentId,
        reconciliationStatus: bundle.reconciliationStatus,
      });
    } catch (error) {
      const message = (error as Error).message ?? "";
      if (message.includes("EXIT_STATE_VERSION_CONFLICT")) {
        return {
          handled: true,
          authorityActive: true,
          decisionKind: decision.kind,
          closed: false,
          partial: false,
          reasonCode: "STATE_VERSION_CONFLICT",
          remainingQuantity: evaluation.state.remainingQuantity,
          reconciliationRequired: true,
        };
      }
      throw error;
    }
  } else {
    await syncExitStateToDb(input.positionId);
  }

  if (!isActionableDecision(decision.kind) || !decision.closeQuantity || decision.closeQuantity <= 0) {
    return {
      handled: true,
      authorityActive: true,
      decisionKind: decision.kind,
      closed: false,
      partial: false,
      reasonCode: decision.reasonCode,
      remainingQuantity: evaluation.state.remainingQuantity,
      reconciliationRequired: false,
    };
  }

  const claim = claimExitQuantity({ state: evaluation.state, quantity: decision.closeQuantity });
  if (!claim.claimed) {
    evaluation.state.orderState = "SUBMITTED";
    await syncExitStateToDb(input.positionId);
    return {
      handled: true,
      authorityActive: true,
      decisionKind: decision.kind,
      closed: false,
      partial: false,
      reasonCode: claim.reasonCode,
      remainingQuantity: evaluation.state.remainingQuantity,
      reconciliationRequired: true,
    };
  }
  const intentId = buildExitIntentId({
    positionId: input.positionId,
    decisionKind: decision.kind,
    quantity: decision.closeQuantity,
    eventId: input.observation.eventId,
    partialLegId: decision.partialLegId,
  });
  registerOpenExitOrder({
    state: evaluation.state,
    intentId,
    requestedQuantity: decision.closeQuantity,
    partialLegId: decision.partialLegId,
  });
  const postIntentBundle = await loadPersistedExitBundle(input.positionId);
  if (postIntentBundle) {
    await savePersistedExitState({
      positionId: input.positionId,
      expectedVersion: postIntentBundle.stateVersion,
      state: evaluation.state,
      processedFillIds: postIntentBundle.processedFillIds,
      activeExitIntentId: intentId,
      reconciliationStatus: postIntentBundle.reconciliationStatus,
    });
  } else {
    await syncExitStateToDb(input.positionId);
  }

  const closeReason = mapDecisionToCloseReason(decision.kind);
  const isPartial =
    decision.kind === "PARTIAL_TAKE_PROFIT" ||
    (decision.closeQuantity < evaluation.state.remainingQuantity && decision.kind !== "RISK_OVERRIDE");

  const settlement = (await settleOpenPosition({
    executionId: input.executionId,
    positionId: input.positionId,
    reason: closeReason,
    mode: input.mode,
    requestedCloseQuantity: decision.closeQuantity,
    settlementFillId: intentId,
    pr04DecisionKind: decision.kind,
    pr04PartialLegId: decision.partialLegId,
    decisionPrice: decision.decisionPrice,
    expectedExitStateVersion: evaluation.state.version,
  })) as SettlementFillResult & { closed?: boolean; partial?: boolean; reason?: string };

  if (!isSuccessfulSettlementFill(settlement)) {
    evaluation.state.orderState = "SUBMITTED";
    await savePersistedExitState({
      positionId: input.positionId,
      expectedVersion: evaluation.state.version,
      state: evaluation.state,
      reconciliationStatus: "RECONCILE_REQUIRED",
    });
    return {
      handled: true,
      authorityActive: true,
      decisionKind: decision.kind,
      closed: false,
      partial: false,
      reasonCode: settlement.reason ?? "SETTLEMENT_FAILED",
      remainingQuantity: evaluation.state.remainingQuantity,
      reconciliationRequired: true,
    };
  }

  const fillEvidence = requireSettlementFillEvidence(settlement);
  if (!fillEvidence) {
    evaluation.state.orderState = "SUBMITTED";
    await savePersistedExitState({
      positionId: input.positionId,
      expectedVersion: evaluation.state.version,
      state: evaluation.state,
      reconciliationStatus: "RECONCILE_REQUIRED",
    });
    return {
      handled: true,
      authorityActive: true,
      decisionKind: decision.kind,
      closed: false,
      partial: false,
      reasonCode: "SETTLEMENT_FILL_EVIDENCE_MISSING",
      remainingQuantity: evaluation.state.remainingQuantity,
      reconciliationRequired: true,
    };
  }

  const finalBundle = await loadPersistedExitBundle(input.positionId);
  if (finalBundle) {
    hydrateExitPolicyState(finalBundle.state);
  }
  const finalState = getExitPolicyState(input.positionId);
  const closed = Boolean(settlement.positionClosed) || (finalState?.remainingQuantity ?? 0) <= 0;
  return {
    handled: true,
    authorityActive: true,
    decisionKind: decision.kind,
    closed,
    partial: Boolean(settlement.partial) || (!closed && fillEvidence.executedQuantity > 0),
    reasonCode: decision.reasonCode,
    remainingQuantity: finalState?.remainingQuantity ?? null,
    reconciliationRequired: false,
  };
}

export function isFix02ShadowEvaluationEnabled() {
  return isPr04ExitEvaluationEnabled();
}
