import { createHash } from "node:crypto";
import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import { getExitPolicyDefinition } from "@/src/server/profitability/pr04-policy-registry";
import { pickHighestPriorityDecision, releaseCompletedExitOrder, shouldSuppressDuplicateExit } from "@/src/server/profitability/pr04-exit-coordinator";
import { buildExitPnlSnapshot } from "@/src/server/profitability/pr04-pnl-accounting";
import { computePartialLegQuantity } from "@/src/server/profitability/pr04-partial-exit";
import { buildRiskReference, resolveStructuralStopFromInvalidation } from "@/src/server/profitability/pr04-structural-stop";
import { evaluateTimeExit, resolveTimeAnchorMs } from "@/src/server/profitability/pr04-time-exit";
import { isTrailingStopHit, updateCausalTrailing } from "@/src/server/profitability/pr04-trailing";
import {
  PR04_POLICY_VERSION,
  PR04_SCHEMA_VERSION,
  type ExitDecision,
  type ExitEvaluationResult,
  type ExitPolicyId,
  type ExitPolicySnapshot,
  type ExitPolicyState,
  type ExitTickObservation,
} from "@/src/server/profitability/pr04-types";

const stateStore = new Map<string, ExitPolicyState>();

export function resetExitPolicyStoreForTests() {
  stateStore.clear();
}

export function hydrateExitPolicyState(state: ExitPolicyState) {
  if (state.activeExitOrder === undefined) state.activeExitOrder = null;
  stateStore.set(state.positionId, JSON.parse(JSON.stringify(state)) as ExitPolicyState);
}

function cloneState(state: ExitPolicyState): ExitPolicyState {
  return JSON.parse(JSON.stringify(state)) as ExitPolicyState;
}

export function getExitPolicyState(positionId: string) {
  return stateStore.get(positionId) ?? null;
}

export function buildExitPolicySnapshotAtEntry(input: {
  positionId: string;
  strategyId: StrategyId;
  entryPolicyVersion: string;
  entrySignalId: string | null;
  setupId: string | null;
  exitPolicyId?: ExitPolicyId;
  experimentalMode?: boolean;
  takeProfitPercent: number | null;
  invalidation: InvalidationContract | null;
  tickSize?: number;
  stepSize?: number;
  minNotional?: number;
  boundAtMs?: number;
}): ExitPolicySnapshot {
  const policyId = input.exitPolicyId ?? "BASELINE_FIXED_TP_SL";
  const def = getExitPolicyDefinition(policyId);
  return {
    schemaVersion: PR04_SCHEMA_VERSION,
    policyVersion: PR04_POLICY_VERSION,
    exitPolicyId: policyId,
    experimentalMode: input.experimentalMode ?? def.experimentalDefault,
    strategyId: input.strategyId,
    entryPolicyVersion: input.entryPolicyVersion,
    positionId: input.positionId,
    entrySignalId: input.entrySignalId,
    setupId: input.setupId,
    boundAtMs: input.boundAtMs ?? Date.now(),
    takeProfitPercent: input.takeProfitPercent,
    structuralInvalidation: input.invalidation,
    trailingActivationPct: def.trailingActivationPct,
    trailingGapPct: def.trailingGapPct,
    partialLegs: def.partialLegs,
    timeExitMs: def.timeExitMs,
    timeReference: def.timeReference,
    tickSize: input.tickSize ?? 0.01,
    stepSize: input.stepSize ?? 0.0001,
    minNotional: input.minNotional ?? 10,
  };
}

export function initializeExitPolicyState(input: {
  snapshot: ExitPolicySnapshot;
  side: "LONG" | "SHORT";
  entryFills: Array<{ price: number; quantity: number; fee: number; atMs: number }>;
  entryFee: number;
}): ExitPolicyState {
  const initialQuantity = input.entryFills.reduce((acc, row) => acc + row.quantity, 0);
  const entryPrice =
    initialQuantity > 0
      ? input.entryFills.reduce((acc, row) => acc + row.price * row.quantity, 0) / initialQuantity
      : 0;
  const structural = resolveStructuralStopFromInvalidation({
    strategyId: input.snapshot.strategyId,
    side: input.side,
    entryPrice,
    invalidation: input.snapshot.structuralInvalidation,
    tickSize: input.snapshot.tickSize,
  });
  const riskReference = buildRiskReference({
    entryPrice,
    initialStopPrice: structural.stopPrice,
    initialQuantity,
    entryFee: input.entryFee,
    includesFeesInBreakEven: true,
    computedAtMs: input.snapshot.boundAtMs,
  });
  const firstFillAt = input.entryFills[0]?.atMs ?? input.snapshot.boundAtMs;
  const state: ExitPolicyState = {
    positionId: input.snapshot.positionId,
    snapshot: input.snapshot,
    initialQuantity,
    remainingQuantity: initialQuantity,
    reservedSellQuantity: 0,
    entryFills: input.entryFills,
    riskReference,
    activeStopPrice: structural.stopPrice,
    trailingHighWaterMark: entryPrice,
    trailingArmed: false,
    completedPartialLegs: [],
    timeAnchorMs: resolveTimeAnchorMs({
      snapshot: input.snapshot,
      firstFillAtMs: firstFillAt,
      positionOpenAtMs: input.snapshot.boundAtMs,
    }),
    lastDataAtMs: firstFillAt,
    lastDecision: "NONE",
    lastReasonCode: null,
    lastEventId: null,
    orderState: "NONE",
    activeExitOrder: null,
    exitFills: [],
    terminalStatus: "OPEN",
    version: 1,
  };
  stateStore.set(input.snapshot.positionId, state);
  return state;
}

export function evaluateExitPolicyTick(input: {
  positionId: string;
  side: "LONG" | "SHORT";
  observation: ExitTickObservation;
  riskOverride?: boolean;
  dryRun?: boolean;
}): ExitEvaluationResult {
  const persisted = stateStore.get(input.positionId);
  if (!persisted) {
    throw new Error(`EXIT_STATE_NOT_FOUND:${input.positionId}`);
  }
  const state = input.dryRun ? cloneState(persisted) : persisted;
  if (state.terminalStatus === "CLOSED" || state.terminalStatus === "CENSORED") {
    return buildResult(state, input.side, {
      kind: "NONE",
      reasonCode: "TERMINAL_STATE",
      decisionAtMs: input.observation.eventAtMs,
      availableAtMs: input.observation.availableAtMs,
      closeQuantity: null,
      decisionPrice: null,
      stopPriceAfter: state.activeStopPrice,
      partialLegId: null,
      duplicateSuppressed: true,
      policyId: state.snapshot.exitPolicyId,
    }, input.observation);
  }
  if (input.observation.stale || input.observation.dataGap || input.observation.markPrice == null) {
    return buildResult(state, input.side, {
      kind: "NONE",
      reasonCode: input.observation.dataGap ? "DATA_GAP" : "STALE_MARK",
      decisionAtMs: input.observation.eventAtMs,
      availableAtMs: input.observation.availableAtMs,
      closeQuantity: null,
      decisionPrice: null,
      stopPriceAfter: state.activeStopPrice,
      partialLegId: null,
      duplicateSuppressed: false,
      policyId: state.snapshot.exitPolicyId,
    }, input.observation);
  }
  const mark = input.observation.markPrice;
  const def = getExitPolicyDefinition(state.snapshot.exitPolicyId);
  const entry = state.riskReference.entryPrice;
  const progressPct = entry > 0 ? ((mark - entry) / entry) * 100 : 0;
  const candidates: ExitDecision[] = [];

  if (input.riskOverride) {
    candidates.push(makeDecision(state, "RISK_OVERRIDE", "RISK_OVERRIDE", mark, state.remainingQuantity, input.observation));
  }

  if (def.structuralStop && state.activeStopPrice != null) {
    const hit = input.side === "LONG" ? mark <= state.activeStopPrice : mark >= state.activeStopPrice;
    if (hit) {
      candidates.push(makeDecision(state, "STRUCTURAL_STOP", "STRUCTURAL_STOP_HIT", mark, state.remainingQuantity, input.observation));
    }
  }

  if (def.fixedTarget && state.snapshot.takeProfitPercent != null && progressPct >= state.snapshot.takeProfitPercent) {
    candidates.push(makeDecision(state, "TAKE_PROFIT", "TARGET_REACHED", mark, state.remainingQuantity, input.observation));
  }

  if (def.partialLegs.length > 0) {
    for (const leg of def.partialLegs) {
      if (progressPct < leg.targetProfitPct) continue;
      const legQty = computePartialLegQuantity({
        legId: leg.legId,
        fractionOfInitial: leg.fractionOfInitial,
        initialQuantity: state.initialQuantity,
        remainingQuantity: state.remainingQuantity,
        completedLegs: state.completedPartialLegs,
        stepSize: state.snapshot.stepSize,
        minNotional: state.snapshot.minNotional,
        markPrice: mark,
      });
      if (legQty.applicable) {
        candidates.push({
          ...makeDecision(state, "PARTIAL_TAKE_PROFIT", legQty.reasonCode, mark, legQty.quantity, input.observation),
          partialLegId: leg.legId,
        });
      }
    }
  }

  if (def.trailing && def.trailingActivationPct != null && def.trailingGapPct != null) {
    const trailing = updateCausalTrailing({
      state,
      side: input.side,
      markPrice: mark,
      observationHigh: input.observation.high,
      observationLow: input.observation.low,
      activationPct: def.trailingActivationPct,
      gapPct: def.trailingGapPct,
      eventId: input.observation.eventId,
      lastProcessedEventId: state.lastEventId,
    });
    state.trailingArmed = trailing.armed;
    state.trailingHighWaterMark = trailing.highWaterMark;
    if (trailing.stopPrice != null) state.activeStopPrice = trailing.stopPrice;
    if (isTrailingStopHit({ side: input.side, markPrice: mark, stopPrice: trailing.stopPrice })) {
      candidates.push(makeDecision(state, "TRAILING_STOP", "TRAILING_STOP_HIT", mark, state.remainingQuantity, input.observation));
    }
  }

  if (def.timeExitMs != null) {
    const time = evaluateTimeExit({
      snapshot: state.snapshot,
      timeAnchorMs: state.timeAnchorMs,
      nowMs: input.observation.eventAtMs,
      progressPct,
      minProgressPct: 0.5,
    });
    if (time.triggered) {
      candidates.push(makeDecision(state, "TIME_EXIT", time.reasonCode, mark, state.remainingQuantity, input.observation));
    }
  }

  if (!candidates.length) {
    candidates.push(makeDecision(state, "NONE", "NO_EXIT", mark, null, input.observation));
  }

  let decision = pickHighestPriorityDecision(candidates);
  if (input.observation.eventId === state.lastEventId) {
    decision = { ...decision, duplicateSuppressed: true, kind: "NONE", reasonCode: "DUPLICATE_EVENT_SUPPRESSED" };
  }
  if (shouldSuppressDuplicateExit({ state, decision })) {
    decision = { ...decision, kind: "NONE", reasonCode: "ORDER_IN_FLIGHT" };
  }

  state.lastEventId = input.observation.eventId;
  state.lastDataAtMs = input.observation.availableAtMs;
  state.lastDecision = decision.kind;
  state.lastReasonCode = decision.reasonCode;
  if (!input.dryRun) {
    state.version += 1;
    stateStore.set(input.positionId, state);
  }
  return buildResult(state, input.side, decision, input.observation);
}

export function applyExitFill(input: {
  positionId: string;
  fill: { price: number; quantity: number; fee: number; feeAsset: "BASE" | "QUOTE" | "UNKNOWN"; atMs: number };
  decisionKind: ExitEvaluationResult["decision"]["kind"];
  partialLegId?: string | null;
  openOrderRemainingQuantity?: number;
}) {
  const state = stateStore.get(input.positionId);
  if (!state) return null;
  const filled = Math.min(input.fill.quantity, state.remainingQuantity);
  state.remainingQuantity = Number((state.remainingQuantity - filled).toFixed(8));
  state.exitFills.push({
    fillId: createHash("sha256").update(`${input.positionId}:${input.fill.atMs}:${filled}`).digest("hex").slice(0, 16),
    side: "SELL",
    price: input.fill.price,
    quantity: filled,
    fee: input.fill.fee,
    feeAsset: input.fill.feeAsset,
    filledAtMs: input.fill.atMs,
    decisionKind: input.decisionKind,
  });
  if (input.partialLegId) state.completedPartialLegs.push(input.partialLegId);
  releaseCompletedExitOrder({
    state,
    filledQuantity: filled,
    openOrderRemainingQuantity: input.openOrderRemainingQuantity,
  });
  state.terminalStatus = state.remainingQuantity <= 0 ? "CLOSED" : "REDUCING";
  stateStore.set(input.positionId, state);
  return state;
}

export function markExitDataEnd(positionId: string) {
  const state = stateStore.get(positionId);
  if (!state) return null;
  if (state.remainingQuantity > 0) state.terminalStatus = "CENSORED";
  stateStore.set(positionId, state);
  return state;
}

function makeDecision(
  state: ExitPolicyState,
  kind: ExitDecision["kind"],
  reasonCode: string,
  mark: number,
  qty: number | null,
  observation: ExitTickObservation,
): ExitDecision {
  return {
    kind,
    reasonCode,
    decisionAtMs: observation.eventAtMs,
    availableAtMs: observation.availableAtMs,
    closeQuantity: qty,
    decisionPrice: mark,
    stopPriceAfter: state.activeStopPrice,
    partialLegId: null,
    duplicateSuppressed: false,
    policyId: state.snapshot.exitPolicyId,
  };
}

function buildResult(
  state: ExitPolicyState,
  side: "LONG" | "SHORT",
  decision: ExitDecision,
  observation: ExitTickObservation,
): ExitEvaluationResult {
  return {
    schemaVersion: PR04_SCHEMA_VERSION,
    policyVersion: PR04_POLICY_VERSION,
    positionId: state.positionId,
    state,
    decision,
    pnl: buildExitPnlSnapshot({ state, markPrice: observation.markPrice, side }),
  };
}
