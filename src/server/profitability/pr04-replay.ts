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
  type ExitPolicyId,
  type ExitPnlSnapshot,
  type ExitTickObservation,
  type MatchedEntryManifest,
  type Pr04ReplayReport,
} from "@/src/server/profitability/pr04-types";

export type Pr04ExitReplayTick = {
  tickIndex: number;
  observation: ExitTickObservation;
  applyFill?: { price: number; quantity: number; fee: number; feeAsset: "BASE" | "QUOTE" | "UNKNOWN" };
};

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
  const snapshot = buildExitPolicySnapshotAtEntry({
    positionId: `replay:${input.manifest.manifestId}`,
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
  let decisionCount = 0;
  let partialCount = 0;
  let fullCloseCount = 0;
  for (const tick of input.ticks) {
    const result = evaluateExitPolicyTick({
      positionId: snapshot.positionId,
      side: input.side ?? "LONG",
      observation: tick.observation,
    });
    if (result.decision.kind !== "NONE") decisionCount += 1;
    if (tick.applyFill) {
      applyExitFill({
        positionId: snapshot.positionId,
        fill: { ...tick.applyFill, atMs: tick.observation.eventAtMs },
        decisionKind: result.decision.kind,
        partialLegId: result.decision.partialLegId,
      });
      if (result.decision.kind === "PARTIAL_TAKE_PROFIT") partialCount += 1;
      if (result.decision.kind === "TAKE_PROFIT" || result.decision.kind === "TRAILING_STOP" || result.decision.kind === "STRUCTURAL_STOP") {
        fullCloseCount += 1;
      }
    }
  }
  markExitDataEnd(snapshot.positionId);
  const censored = partialCount === 0 && fullCloseCount === 0 ? 1 : 0;
  return {
    schemaVersion: PR04_SCHEMA_VERSION,
    policyVersion: PR04_POLICY_VERSION,
    datasetId: input.datasetId,
    manifestId: input.manifest.manifestId,
    policyId: input.policyId,
    tickCount: input.ticks.length,
    decisionCount,
    partialCount,
    fullCloseCount,
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
};

export function runPr04ExitReplayWithOutcome(input: {
  datasetId: string;
  manifest: MatchedEntryManifest;
  policyId: ExitPolicyId;
  ticks: Pr04ExitReplayTick[];
  side?: "LONG" | "SHORT";
  experimentalMode?: boolean;
}): Pr04ExitReplayOutcome {
  const report = runPr04ExitReplayAnalysis(input);
  const positionId = `replay:${input.manifest.manifestId}`;
  const finalState = getExitPolicyState(positionId);
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
  return { report, pnl, rMultiple, terminalStatus, closed };
}
