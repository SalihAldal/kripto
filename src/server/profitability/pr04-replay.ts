import {
  applyExitFill,
  evaluateExitPolicyTick,
  getExitPolicyState,
  initializeExitPolicyState,
  markExitDataEnd,
  resetExitPolicyStoreForTests,
} from "@/src/server/profitability/pr04-exit-evaluator";
import { buildExitPolicySnapshotAtEntry } from "@/src/server/profitability/pr04-exit-evaluator";
import { buildExitPnlSnapshot } from "@/src/server/profitability/pr04-pnl-accounting";
import { computeRMultiple } from "@/src/server/profitability/pr04-structural-stop";
import {
  PR04_POLICY_VERSION,
  PR04_SCHEMA_VERSION,
  type ExitDecisionKind,
  type ExitPolicyId,
  type ExitPnlSnapshot,
  type ExitTickObservation,
  type MatchedEntryManifest,
  type Pr04ReplayReport,
} from "@/src/server/profitability/pr04-types";

export {
  runPr04CounterfactualExitReplayWithOutcome,
  stepPr04CounterfactualExitReplayTick,
  type Pr04CounterfactualReplayConfig,
  type Pr04CounterfactualReplayTick,
} from "@/src/server/profitability/pr04-counterfactual-replay";

export type Pr04ExitReplayTick = {
  tickIndex: number;
  observation: ExitTickObservation;
  applyFill?: { price: number; quantity: number; fee: number; feeAsset: "BASE" | "QUOTE" | "UNKNOWN" };
  /** AUDIT_RECONCILE: apply fill for a prior open order on a NONE decision tick. */
  fillMode?: "DECISION" | "AUDIT_RECONCILE";
};

export type Pr04ExitReplaySession = {
  positionId: string;
  side: "LONG" | "SHORT";
  policyId: ExitPolicyId;
  manifest: MatchedEntryManifest;
  openExitOrder: {
    decisionKind: ExitDecisionKind;
    partialLegId: string | null;
    requestedQuantity: number;
  } | null;
  decisionCount: number;
  partialCount: number;
  fullCloseCount: number;
  closedAtMs: number | null;
};

function isFullCloseKind(kind: ExitDecisionKind) {
  return kind === "TAKE_PROFIT" || kind === "TRAILING_STOP" || kind === "STRUCTURAL_STOP" || kind === "RISK_OVERRIDE";
}

function isActionableDecision(kind: ExitDecisionKind, closeQuantity: number | null) {
  return kind !== "NONE" && closeQuantity != null && closeQuantity > 0;
}

export function createPr04ExitReplaySession(input: {
  manifest: MatchedEntryManifest;
  policyId: ExitPolicyId;
  side?: "LONG" | "SHORT";
  experimentalMode?: boolean;
}): Pr04ExitReplaySession {
  const positionId = `replay:${input.manifest.manifestId}`;
  const snapshot = buildExitPolicySnapshotAtEntry({
    positionId,
    strategyId: input.manifest.strategyId,
    entryPolicyVersion: input.manifest.entryPolicyVersion,
    entrySignalId: input.manifest.entrySignalId,
    setupId: null,
    exitPolicyId: input.policyId,
    experimentalMode: input.experimentalMode ?? true,
    takeProfitPercent: 3,
    invalidation: input.manifest.invalidation,
  });
  initializeExitPolicyState({
    snapshot,
    side: input.side ?? "LONG",
    entryFills: input.manifest.fills,
    entryFee: input.manifest.fills.reduce((acc, row) => acc + row.fee, 0),
  });
  return {
    positionId,
    side: input.side ?? "LONG",
    policyId: input.policyId,
    manifest: input.manifest,
    openExitOrder: null,
    decisionCount: 0,
    partialCount: 0,
    fullCloseCount: 0,
    closedAtMs: null,
  };
}

export function stepPr04ExitReplayTick(
  session: Pr04ExitReplaySession,
  tick: Pr04ExitReplayTick,
): {
  decisionKind: ExitDecisionKind;
  fillApplied: boolean;
  fillRejectedReason: string | null;
  closed: boolean;
} {
  const result = evaluateExitPolicyTick({
    positionId: session.positionId,
    side: session.side,
    observation: tick.observation,
  });
  const decision = result.decision;
  if (decision.kind !== "NONE") session.decisionCount += 1;

  if (isActionableDecision(decision.kind, decision.closeQuantity)) {
    session.openExitOrder = {
      decisionKind: decision.kind,
      partialLegId: decision.partialLegId,
      requestedQuantity: decision.closeQuantity!,
    };
  }

  let fillApplied = false;
  let fillRejectedReason: string | null = null;
  if (tick.applyFill) {
    const actionable = isActionableDecision(decision.kind, decision.closeQuantity);
    const hasOpenOrder = session.openExitOrder != null;
    if (!actionable && !hasOpenOrder) {
      fillRejectedReason = "FILL_WITHOUT_OPEN_ORDER";
    } else {
      const fillKind = actionable ? decision.kind : session.openExitOrder!.decisionKind;
      const partialLegId = actionable ? decision.partialLegId : session.openExitOrder!.partialLegId;
      applyExitFill({
        positionId: session.positionId,
        fill: { ...tick.applyFill, atMs: tick.observation.eventAtMs },
        decisionKind: fillKind,
        partialLegId,
        openOrderRemainingQuantity: 0,
      });
      fillApplied = true;
      if (fillKind === "PARTIAL_TAKE_PROFIT") session.partialCount += 1;
      if (isFullCloseKind(fillKind)) session.fullCloseCount += 1;
      const remaining = getExitPolicyState(session.positionId)?.remainingQuantity ?? 0;
      if (remaining <= 0) {
        session.closedAtMs = tick.observation.eventAtMs;
        session.openExitOrder = null;
      } else if (tick.applyFill.quantity >= (session.openExitOrder?.requestedQuantity ?? 0)) {
        session.openExitOrder = null;
      }
    }
  }

  const state = getExitPolicyState(session.positionId);
  const closed = state?.terminalStatus === "CLOSED";
  if (closed && session.closedAtMs == null) session.closedAtMs = tick.observation.eventAtMs;
  return {
    decisionKind: decision.kind,
    fillApplied,
    fillRejectedReason,
    closed,
  };
}

export function finalizePr04ExitReplaySession(session: Pr04ExitReplaySession) {
  markExitDataEnd(session.positionId);
  const finalState = getExitPolicyState(session.positionId);
  const closed = finalState?.terminalStatus === "CLOSED";
  return { finalState, closed };
}

export function runPr04ExitReplayAnalysis(input: {
  datasetId: string;
  manifest: MatchedEntryManifest;
  policyId: ExitPolicyId;
  ticks: Pr04ExitReplayTick[];
  side?: "LONG" | "SHORT";
  experimentalMode?: boolean;
}): Pr04ReplayReport {
  resetExitPolicyStoreForTests();
  if (!input.ticks.length) {
    return {
      schemaVersion: PR04_SCHEMA_VERSION,
      policyVersion: PR04_POLICY_VERSION,
      datasetId: input.datasetId,
      manifestId: input.manifest.manifestId,
      policyId: input.policyId,
      tickCount: 0,
      decisionCount: 0,
      partialCount: 0,
      fullCloseCount: 0,
      censoredCount: 0,
      status: "NOT_RUN",
      reason: "EMPTY_DATASET",
    };
  }
  const session = createPr04ExitReplaySession(input);
  for (const tick of input.ticks) {
    stepPr04ExitReplayTick(session, tick);
  }
  finalizePr04ExitReplaySession(session);
  const censored = session.partialCount === 0 && session.fullCloseCount === 0 ? 1 : 0;
  return {
    schemaVersion: PR04_SCHEMA_VERSION,
    policyVersion: PR04_POLICY_VERSION,
    datasetId: input.datasetId,
    manifestId: input.manifest.manifestId,
    policyId: input.policyId,
    tickCount: input.ticks.length,
    decisionCount: session.decisionCount,
    partialCount: session.partialCount,
    fullCloseCount: session.fullCloseCount,
    censoredCount: censored,
    status: "COMPLETED",
    reason: null,
  };
}

export type Pr04ExitReplayOutcome = {
  report: Pr04ReplayReport;
  pnl: ExitPnlSnapshot | null;
  rMultiple: number | null;
  terminalStatus: "OPEN" | "REDUCING" | "CLOSED" | "CENSORED" | null;
  closed: boolean;
  closedAtMs: number | null;
};

export function runPr04ExitReplayWithOutcome(input: {
  datasetId: string;
  manifest: MatchedEntryManifest;
  policyId: ExitPolicyId;
  ticks: Pr04ExitReplayTick[];
  side?: "LONG" | "SHORT";
  experimentalMode?: boolean;
}): Pr04ExitReplayOutcome {
  resetExitPolicyStoreForTests();
  const session = createPr04ExitReplaySession(input);
  for (const tick of input.ticks) {
    stepPr04ExitReplayTick(session, tick);
  }
  finalizePr04ExitReplaySession(session);
  const censored = session.partialCount === 0 && session.fullCloseCount === 0 ? 1 : 0;
  const report: Pr04ReplayReport = {
    schemaVersion: PR04_SCHEMA_VERSION,
    policyVersion: PR04_POLICY_VERSION,
    datasetId: input.datasetId,
    manifestId: input.manifest.manifestId,
    policyId: input.policyId,
    tickCount: input.ticks.length,
    decisionCount: session.decisionCount,
    partialCount: session.partialCount,
    fullCloseCount: session.fullCloseCount,
    censoredCount: censored,
    status: "COMPLETED",
    reason: null,
  };
  const finalState = getExitPolicyState(session.positionId);
  const lastMark = input.ticks.length ? input.ticks[input.ticks.length - 1]!.observation.markPrice : null;
  const pnl =
    finalState != null
      ? buildExitPnlSnapshot({ state: finalState, markPrice: lastMark, side: input.side ?? "LONG" })
      : null;
  const rMultiple =
    finalState != null && pnl?.realizedNetPnl != null
      ? computeRMultiple({
          realizedNetPnl: pnl.realizedNetPnl,
          riskReference: finalState.riskReference,
        })
      : null;
  const terminalStatus = finalState?.terminalStatus ?? null;
  const closed = terminalStatus === "CLOSED";
  return {
    report,
    pnl,
    rMultiple,
    terminalStatus,
    closed,
    closedAtMs: session.closedAtMs,
  };
}
