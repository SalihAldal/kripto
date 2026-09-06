import { evaluateMultipleTesting } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { EXIT_POLICY_REGISTRY } from "@/src/server/profitability/pr04-policy-registry";
import { runPr04ExitReplayWithOutcome } from "@/src/server/profitability/pr04-replay";
import { buildPr05DataInventory } from "@/src/server/profitability/pr05-data-inventory";
import { createLockedPr05ExperimentManifest } from "@/src/server/profitability/pr05-experiment-manifest";
import { evaluateOfflineCandidate } from "@/src/server/profitability/pr05-candidate-evaluation";
import { runCostStressEvaluation } from "@/src/server/profitability/pr05-cost-stress";
import { aggregateTradeOutcomes } from "@/src/server/profitability/pr05-metrics";
import { shiftSignalBlocksWithSeed } from "@/src/server/profitability/pr05-negative-control";
import { buildPr05SplitManifest, resolveManifestSplit } from "@/src/server/profitability/pr05-split-manifest";
import {
  PR05_EXPERIMENT_ID,
  PR05_POLICY_VERSION,
  PR05_SCHEMA_VERSION,
  type Pr05LifecycleRow,
  type Pr05MatchedExitInput,
  type Pr05OfflineComparisonReport,
  type Pr05TradeOutcome,
} from "@/src/server/profitability/pr05-types";

export function runMatchedExitComparison(input: Pr05MatchedExitInput): {
  outcomes: Pr05TradeOutcome[];
  lifecycleRows: Pr05LifecycleRow[];
} {
  const policyIds = input.policyIds ?? (Object.keys(EXIT_POLICY_REGISTRY) as Pr05MatchedExitInput["policyIds"]);
  const outcomes: Pr05TradeOutcome[] = [];
  const lifecycleRows: Pr05LifecycleRow[] = [];
  for (const manifest of input.manifests) {
    const ticks = input.ticksByManifestId[manifest.manifestId] ?? [];
    const lifecycleId = manifest.entrySignalId;
    lifecycleRows.push({
      lifecycleId,
      eventAtMs: manifest.entryAtMs,
      labelEndAtMs: manifest.replayWindow.toMs,
      manifest,
    });
    for (const policyId of policyIds ?? []) {
      const outcome = runPr04ExitReplayWithOutcome({
        datasetId: input.datasetId,
        manifest,
        policyId,
        ticks,
      });
      const censored = outcome.terminalStatus === "CENSORED" || outcome.terminalStatus === "OPEN";
      outcomes.push({
        manifestId: manifest.manifestId,
        lifecycleId,
        strategyId: manifest.strategyId,
        exitPolicyId: policyId,
        split: "UNASSIGNED",
        entryAtMs: manifest.entryAtMs,
        closed: outcome.closed,
        censored,
        grossPnl: outcome.pnl?.realizedGrossPnl ?? null,
        netPnl: outcome.pnl?.realizedNetPnl ?? null,
        fees: outcome.pnl?.realizedFees ?? 0,
        rMultiple: outcome.rMultiple,
        holdingMs: manifest.replayWindow.toMs - manifest.replayWindow.fromMs,
        symbol: null,
        regime: null,
        pnlStatus: outcome.pnl?.status ?? "UNKNOWN",
        equalRiskComparable: manifest.riskReference.quality === "VALID",
      });
    }
  }
  return { outcomes, lifecycleRows };
}

export function runPr05OfflineComparison(input: Pr05MatchedExitInput): Pr05OfflineComparisonReport {
  const generatedAtMs = Date.now();
  const dataInventory = buildPr05DataInventory({ nowMs: generatedAtMs });
  const experimentManifest = createLockedPr05ExperimentManifest({
    headCommit: input.headCommit ?? "UNKNOWN",
    recordedMarketAvailable: dataInventory.recordedMarketDatasetAvailable,
    priorDevelopmentRangesTouched: true,
    lockedAtMs: generatedAtMs,
  });

  if (!input.recordedMarketData || !dataInventory.recordedMarketDatasetAvailable) {
    return {
      schemaVersion: PR05_SCHEMA_VERSION,
      policyVersion: PR05_POLICY_VERSION,
      experimentId: PR05_EXPERIMENT_ID,
      datasetId: input.datasetId,
      generatedAtMs,
      status: "BLOCKED",
      reason: "PR05-DATA-01: recorded market replay package unavailable",
      experimentManifest,
      splitManifest: null,
      dataInventory,
      variantCount: experimentManifest.exitPolicyIds.length,
      independentLifecycleGroups: 0,
      closedTradeCount: 0,
      matchedExitOutcomes: [],
      portfolioOutcomes: [],
      aggregates: [],
      negativeControl: {
        method: experimentManifest.negativeControl.method,
        seed: experimentManifest.negativeControl.seed,
        iterations: experimentManifest.negativeControl.iterations,
        realNetExpectancy: null,
        controlNetExpectancies: [],
        breaksDependency: false,
        verdict: "NOT_RUN",
        reason: "MARKET_DATA_BLOCKED",
      },
      costStress: [],
      holdoutEvaluationStatus: "NOT_RUN",
      profitabilityEvidence: "INSUFFICIENT_DATA",
      offlineCandidateVerdict: "BLOCKED",
      selectedCandidateIds: [],
      openBlockers: [...dataInventory.blockers, "PR05-DATA-01"],
    };
  }

  const { outcomes, lifecycleRows } = runMatchedExitComparison(input);
  const splitManifest = buildPr05SplitManifest({ experimentManifest, rows: lifecycleRows });
  for (const row of outcomes) {
    row.split = resolveManifestSplit(row.manifestId, splitManifest);
  }
  const closedTradeCount = outcomes.filter((o) => o.closed && !o.censored).length;
  const independentLifecycleGroups = new Set(lifecycleRows.map((r) => r.lifecycleId)).size;
  const aggregates = experimentManifest.exitPolicyIds.map((policyId) =>
    aggregateTradeOutcomes({
      outcomes: outcomes.filter((o) => o.exitPolicyId === policyId),
      variantKey: `matched-exit:${policyId}`,
      strategyId: "MOMENTUM_CONTINUATION",
      exitPolicyId: policyId,
      comparisonType: "MATCHED_EXIT",
    }),
  );
  const closedPnls = outcomes.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!);
  const entryPrices = outcomes.filter((o) => o.closed && o.netPnl != null).map(() => 100);
  const negativeControl = shiftSignalBlocksWithSeed({
    outcomes,
    seed: experimentManifest.negativeControl.seed,
    iterations: experimentManifest.negativeControl.iterations,
    shiftBlocks: 1,
  });
  const costStress = runCostStressEvaluation({ baseNetPnls: closedPnls, entryPrices });
  const candidate = evaluateOfflineCandidate({
    experimentManifest,
    recordedMarketAvailable: true,
    closedTradeCount,
    independentLifecycleGroups,
    holdoutUsable: splitManifest.holdoutUsable,
    negativeControlVerdict: negativeControl.verdict,
    aggregates,
    baselinePolicyId: experimentManifest.baselinePolicyId,
  });
  const insufficientData =
    independentLifecycleGroups < experimentManifest.minIndependentLifecycleGroups ||
    closedTradeCount < experimentManifest.minClosedTradesPerSplit;
  return {
    schemaVersion: PR05_SCHEMA_VERSION,
    policyVersion: PR05_POLICY_VERSION,
    experimentId: PR05_EXPERIMENT_ID,
    datasetId: input.datasetId,
    generatedAtMs,
    status: insufficientData ? "INSUFFICIENT_DATA" : "COMPLETED",
    reason: insufficientData ? "INSUFFICIENT_INDEPENDENT_SAMPLES" : null,
    experimentManifest,
    splitManifest,
    dataInventory,
    variantCount: experimentManifest.exitPolicyIds.length * input.manifests.length,
    independentLifecycleGroups,
    closedTradeCount,
    matchedExitOutcomes: outcomes,
    portfolioOutcomes: [],
    aggregates,
    negativeControl,
    costStress,
    holdoutEvaluationStatus: splitManifest.holdoutUsable ? "COMPLETED" : "HOLDOUT_PROVENANCE_UNKNOWN",
    profitabilityEvidence: candidate.profitabilityEvidence,
    offlineCandidateVerdict: candidate.offlineCandidateVerdict,
    selectedCandidateIds: candidate.selectedCandidateIds,
    openBlockers: insufficientData ? ["PR05-SAMPLE-01"] : [],
  };
}

export function runPr05EngineeringFixtureComparison(input: Pr05MatchedExitInput): Pr05OfflineComparisonReport {
  const generatedAtMs = Date.now();
  const dataInventory = buildPr05DataInventory({ nowMs: generatedAtMs });
  const experimentManifest = createLockedPr05ExperimentManifest({
    headCommit: input.headCommit ?? "UNKNOWN",
    recordedMarketAvailable: false,
    priorDevelopmentRangesTouched: true,
    lockedAtMs: generatedAtMs,
  });
  const { outcomes, lifecycleRows } = runMatchedExitComparison(input);
  const splitManifest = buildPr05SplitManifest({ experimentManifest, rows: lifecycleRows });
  for (const row of outcomes) {
    row.split = resolveManifestSplit(row.manifestId, splitManifest);
  }
  const aggregates = experimentManifest.exitPolicyIds.map((policyId) =>
    aggregateTradeOutcomes({
      outcomes: outcomes.filter((o) => o.exitPolicyId === policyId),
      variantKey: `fixture:${policyId}`,
      strategyId: outcomes[0]?.strategyId ?? "EARLY_ACCELERATION",
      exitPolicyId: policyId,
      comparisonType: "MATCHED_EXIT",
    }),
  );
  const negativeControl = shiftSignalBlocksWithSeed({
    outcomes,
    seed: experimentManifest.negativeControl.seed,
    iterations: 10,
    shiftBlocks: 1,
  });
  const closedPnls = outcomes.filter((o) => o.closed && o.netPnl != null).map((o) => o.netPnl!);
  const costStress = runCostStressEvaluation({
    baseNetPnls: closedPnls,
    entryPrices: outcomes.filter((o) => o.closed).map(() => 100),
  });
  return {
    schemaVersion: PR05_SCHEMA_VERSION,
    policyVersion: PR05_POLICY_VERSION,
    experimentId: PR05_EXPERIMENT_ID,
    datasetId: input.datasetId,
    generatedAtMs,
    status: "COMPLETED",
    reason: "ENGINEERING_FIXTURE_ONLY_NOT_MARKET_EVIDENCE",
    experimentManifest,
    splitManifest,
    dataInventory,
    variantCount: outcomes.length,
    independentLifecycleGroups: new Set(lifecycleRows.map((r) => r.lifecycleId)).size,
    closedTradeCount: outcomes.filter((o) => o.closed).length,
    matchedExitOutcomes: outcomes,
    portfolioOutcomes: [],
    aggregates,
    negativeControl,
    costStress,
    holdoutEvaluationStatus: "HOLDOUT_PROVENANCE_UNKNOWN",
    profitabilityEvidence: "NOT_ESTABLISHED",
    offlineCandidateVerdict: "INSUFFICIENT_DATA",
    selectedCandidateIds: [],
    openBlockers: ["PR05-DATA-01", "ENGINEERING_FIXTURE_ONLY"],
  };
}
