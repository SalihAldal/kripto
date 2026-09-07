import {
  applyExitFill,
  evaluateExitPolicyTick,
  getExitPolicyState,
  initializeExitPolicyState,
  markExitDataEnd,
  resetExitPolicyStoreForTests,
  buildExitPolicySnapshotAtEntry,
} from "@/src/server/profitability/pr04-exit-evaluator";
import { buildExitPnlSnapshot } from "@/src/server/profitability/pr04-pnl-accounting";
import { computeRMultiple } from "@/src/server/profitability/pr04-structural-stop";
import {
  censorOpenCounterfactualPosition,
  planCounterfactualExitTick,
  type CounterfactualExitOrderIntent,
} from "@/src/server/profitability/counterfactual-exit-execution";
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
import type { Pr04ExitReplaySession, Pr04ExitReplayTick } from "@/src/server/profitability/pr04-replay";

export type Pr04CounterfactualReplayConfig = {
  latencyMs: number;
  feeRate: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
};

export type Pr04CounterfactualReplayTick = Pr04ExitReplayTick & {
  quotePrice?: number | null;
  decisionAtMs?: number | null;
};

function isFullCloseKind(kind: ExitDecisionKind) {
  return kind === "TAKE_PROFIT" || kind === "TRAILING_STOP" || kind === "STRUCTURAL_STOP" || kind === "RISK_OVERRIDE";
}

function resolveQuotePrice(tick: Pr04CounterfactualReplayTick) {
  if (tick.quotePrice != null && Number.isFinite(tick.quotePrice) && tick.quotePrice > 0) return tick.quotePrice;
  const obs = tick.observation;
  const bid = obs.bid;
  if (bid != null && Number.isFinite(bid) && bid > 0) return bid;
  const mark = obs.markPrice;
  if (mark != null && Number.isFinite(mark) && mark > 0) return mark;
  return null;
}

export function stepPr04CounterfactualExitReplayTick(
  session: Pr04ExitReplaySession,
  tick: Pr04CounterfactualReplayTick,
  config: Pr04CounterfactualReplayConfig,
  openOrder: CounterfactualExitOrderIntent | null,
): {
  openOrder: CounterfactualExitOrderIntent | null;
  decisionKind: ExitDecisionKind;
  fillApplied: boolean;
  fillRejectedReason: string | null;
  closed: boolean;
  censored: boolean;
} {
  const result = evaluateExitPolicyTick({
    positionId: session.positionId,
    side: session.side,
    observation: tick.observation,
  });
  const decision = result.decision;
  if (decision.kind !== "NONE") session.decisionCount += 1;

  const planned = planCounterfactualExitTick({
    observation: tick.observation,
    decisionKind: decision.kind,
    closeQuantity: decision.closeQuantity,
    partialLegId: decision.partialLegId,
    quotePrice: resolveQuotePrice(tick),
    latencyMs: config.latencyMs,
    feeRate: config.feeRate,
    feeAsset: config.feeAsset,
    decisionAtMs: tick.decisionAtMs ?? (decision.kind !== "NONE" ? tick.observation.eventAtMs : null),
    openOrder,
  });

  let fillApplied = false;
  let fillRejectedReason = planned.rejectedReason ?? null;
  if (planned.fill) {
    applyExitFill({
      positionId: session.positionId,
      fill: {
        price: planned.fill.price,
        quantity: planned.fill.quantity,
        fee: planned.fill.fee,
        feeAsset: planned.fill.feeAsset ?? config.feeAsset,
        atMs: planned.fill.fillAtMs,
      },
      decisionKind: planned.fill.decisionKind,
      partialLegId: planned.fill.partialLegId,
      openOrderRemainingQuantity: planned.openOrder?.requestedQuantity ?? 0,
    });
    fillApplied = true;
    if (planned.fill.decisionKind === "PARTIAL_TAKE_PROFIT") session.partialCount += 1;
    if (isFullCloseKind(planned.fill.decisionKind)) session.fullCloseCount += 1;
    const remaining = getExitPolicyState(session.positionId)?.remainingQuantity ?? 0;
    if (remaining <= 0) {
      session.closedAtMs = planned.fill.fillAtMs;
    }
  }

  const state = getExitPolicyState(session.positionId);
  const closed = state?.terminalStatus === "CLOSED";
  if (closed && session.closedAtMs == null) session.closedAtMs = tick.observation.eventAtMs;
  return {
    openOrder: planned.openOrder,
    decisionKind: decision.kind,
    fillApplied,
    fillRejectedReason,
    closed,
    censored: false,
  };
}

export function runPr04CounterfactualExitReplayWithOutcome(input: {
  datasetId: string;
  manifest: MatchedEntryManifest;
  policyId: ExitPolicyId;
  ticks: Pr04CounterfactualReplayTick[];
  side?: "LONG" | "SHORT";
  experimentalMode?: boolean;
  config: Pr04CounterfactualReplayConfig;
  windowEndMs?: number;
}) {
  resetExitPolicyStoreForTests();
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
  const session: Pr04ExitReplaySession = {
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

  let openOrder: CounterfactualExitOrderIntent | null = null;
  let censored = false;
  for (const tick of input.ticks) {
    const step = stepPr04CounterfactualExitReplayTick(session, tick, input.config, openOrder);
    openOrder = step.openOrder;
    censored = step.censored;
  }

  const windowEndMs = input.windowEndMs ?? input.ticks[input.ticks.length - 1]?.observation.eventAtMs ?? Date.now();
  if (!session.closedAtMs && openOrder) {
    const censor = censorOpenCounterfactualPosition(openOrder, windowEndMs);
    censored = censor.censored;
    openOrder = censor.openOrder;
  }

  markExitDataEnd(session.positionId);
  const censoredCount = censored || (session.partialCount === 0 && session.fullCloseCount === 0) ? 1 : 0;
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
    censoredCount,
    status: "COMPLETED",
    reason: null,
  };
  const finalState = getExitPolicyState(session.positionId);
  const lastMark = input.ticks.length ? input.ticks[input.ticks.length - 1]!.observation.markPrice : null;
  const pnl: ExitPnlSnapshot | null =
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
  const terminalStatus = censored ? "CENSORED" : finalState?.terminalStatus ?? null;
  const closed = terminalStatus === "CLOSED";
  return {
    report,
    pnl,
    rMultiple,
    terminalStatus,
    closed,
    closedAtMs: session.closedAtMs,
    openOrder,
    censored,
  };
}
