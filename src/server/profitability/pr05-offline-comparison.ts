import { evaluateMultipleTesting } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { EXIT_POLICY_REGISTRY } from "@/src/server/profitability/pr04-policy-registry";
import { runPr04ExitReplayWithOutcome } from "@/src/server/profitability/pr04-replay";
import { buildPr05DataInventory } from "@/src/server/profitability/pr05-data-inventory";
import { createLockedPr05ExperimentManifest } from "@/src/server/profitability/pr05-experiment-manifest";
import { evaluateOfflineCandidate } from "@/src/server/profitability/pr05-candidate-evaluation";
import { runCostStressEvaluation } from "@/src/server/profitability/pr05-cost-stress";
import { aggregateTradeOutcomes } from "@/src/server/profitability/pr05-metrics";
import { runCausalEntryShiftNegativeControl } from "@/src/server/profitability/pr05-negative-control";
import { runPortfolioReplay } from "@/src/server/profitability/pr05-portfolio-replay";
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

function resolveClosedAtMs(input: {
  manifest: Pr05MatchedExitInput["manifests"][number];
  ticks: Pr05MatchedExitInput["ticksByManifestId"][string];
  closed: boolean;
  closedAtMs?: number | null;
}) {
  if (!input.closed) return null;
  if (input.closedAtMs != null) return input.closedAtMs;
  const lastTick = input.ticks.length ? input.ticks[input.ticks.length - 1]!.observation.eventAtMs : null;
  return lastTick ?? input.manifest.replayWindow.toMs;
}

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
      const replay = runPr04ExitReplayWithOutcome({
        datasetId: input.datasetId,
        manifest,
        policyId,
        ticks,
      });
      const censored = replay.terminalStatus === "CENSORED" || replay.terminalStatus === "OPEN";
      const closedAtMs = resolveClosedAtMs({
        manifest,
        ticks,
        closed: replay.closed,
        closedAtMs: replay.closedAtMs,
      });
      const holdingMs = closedAtMs != null ? closedAtMs - manifest.entryAtMs : null;
      outcomes.push({
        manifestId: manifest.manifestId,
        lifecycleId,
        strategyId: manifest.strategyId,
        exitPolicyId: policyId,
        split: "UNASSIGNED",
        entryAtMs: manifest.entryAtMs,
        closed: replay.closed,
        censored,
        grossPnl: replay.pnl?.realizedGrossPnl ?? null,
        netPnl: replay.pnl?.realizedNetPnl ?? null,
        fees: replay.pnl?.realizedFees ?? 0,
        rMultiple: replay.rMultiple,
        holdingMs,
        symbol: manifest.symbol ?? null,
        regime: manifest.regime ?? null,
        pnlStatus: replay.pnl?.status ?? "UNKNOWN",
        equalRiskComparable: manifest.riskReference.quality === "VALID",
      });
    }
  }
  return { outcomes, lifecycleRows };
}

function buildSplitAggregates(input: {
  outcomes: Pr05TradeOutcome[];
  experimentManifest: ReturnType<typeof createLockedPr05ExperimentManifest>;
  comparisonType: "MATCHED_EXIT" | "PORTFOLIO_REPLAY";
}) {
  const splits: Array<"TRAIN" | "VALIDATION" | "TEST"> = ["TRAIN", "VALIDATION", "TEST"];
  const aggregates = [];
  for (const policyId of input.experimentManifest.exitPolicyIds) {
    const policyOutcomes = input.outcomes.filter((o) => o.exitPolicyId === policyId);
    const strategyId = policyOutcomes[0]?.strategyId ?? "MOMENTUM_CONTINUATION";
    for (const split of splits) {
      aggregates.push(
        aggregateTradeOutcomes({
          outcomes: policyOutcomes,
          variantKey: `${input.comparisonType}:${policyId}:${split}`,
          strategyId,
          exitPolicyId: policyId,
          comparisonType: input.comparisonType,
          split,
        }),
      );
    }
    aggregates.push(
      aggregateTradeOutcomes({
        outcomes: policyOutcomes,
        variantKey: `${input.comparisonType}:${policyId}:ALL`,
        strategyId,
        exitPolicyId: policyId,
        comparisonType: input.comparisonType,
        split: "ALL",
      }),
    );
  }
  return aggregates;
}

export function runPr05OfflineComparison(input: Pr05MatchedExitInput): Pr05OfflineComparisonReport {
  const generatedAtMs = Date.now();
  const dataInventory = buildPr05DataInventory({ nowMs: generatedAtMs });
  const priorDevelopmentRangesTouched = dataInventory.entries.some(
    (e) => e.sourceClass === "PRIOR_DEVELOPMENT_TOUCHED",
  );
  const experimentManifest = createLockedPr05ExperimentManifest({
    headCommit: input.headCommit ?? "UNKNOWN",
    recordedMarketAvailable: dataInventory.recordedMarketDatasetAvailable,
    priorDevelopmentRangesTouched,
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
        procedureApplied: false,
        implementationVerdict: "INSUFFICIENT_DATA",
        significanceVerdict: "NOT_EVALUATED",
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
  const aggregates = buildSplitAggregates({
    outcomes,
    experimentManifest,
    comparisonType: "MATCHED_EXIT",
  });
  const holdoutAggregates = aggregates.filter((a) => a.variantKey.endsWith(":TEST"));
  const closedOutcomes = outcomes.filter((o) => o.closed && o.netPnl != null);
  const entryPrices = closedOutcomes.map((o) => {
    const manifest = lifecycleRows.find((r) => r.manifest.manifestId === o.manifestId)?.manifest;
    const fill = manifest?.fills[0];
    return fill?.price ?? null;
  }).filter((price): price is number => price != null);
  const negativeControl = runCausalEntryShiftNegativeControl({
    datasetId: input.datasetId,
    manifests: input.manifests,
    ticksByManifestId: input.ticksByManifestId,
    policyIds: input.policyIds ?? experimentManifest.exitPolicyIds,
    seed: experimentManifest.negativeControl.seed,
    iterations: Math.min(experimentManifest.negativeControl.iterations, 50),
  });
  const costStress = runCostStressEvaluation({
    baseNetPnls: closedOutcomes.map((o) => o.netPnl!),
    entryPrices,
  });
  const portfolio = runPortfolioReplay({
    datasetId: input.datasetId,
    lifecycleRows,
    policyId: experimentManifest.baselinePolicyId,
    ticksByManifestId: input.ticksByManifestId,
    startingCapital: experimentManifest.startingCapital,
    maxConcurrentPositions: 1,
  });
  for (const row of portfolio.outcomes) {
    row.split = resolveManifestSplit(row.manifestId, splitManifest);
  }
  const portfolioAggregates = aggregateTradeOutcomes({
    outcomes: portfolio.outcomes,
    variantKey: `portfolio:${experimentManifest.baselinePolicyId}:ALL`,
    strategyId: "PORTFOLIO",
    exitPolicyId: experimentManifest.baselinePolicyId,
    comparisonType: "PORTFOLIO_REPLAY",
    split: "ALL",
  });
  const candidate = evaluateOfflineCandidate({
    experimentManifest,
    recordedMarketAvailable: true,
    closedTradeCount,
    independentLifecycleGroups,
    holdoutUsable: splitManifest.holdoutUsable,
    negativeControlVerdict: negativeControl.implementationVerdict === "PASS" ? "PASS" : negativeControl.verdict,
    aggregates: holdoutAggregates,
    baselinePolicyId: experimentManifest.baselinePolicyId,
  });
  const insufficientData =
    independentLifecycleGroups < experimentManifest.minIndependentLifecycleGroups ||
    closedTradeCount < experimentManifest.minClosedTradesPerSplit;
  void evaluateMultipleTesting;
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
    portfolioOutcomes: portfolio.outcomes,
    aggregates: [...aggregates, portfolioAggregates],
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
    priorDevelopmentRangesTouched: dataInventory.entries.some((e) => e.sourceClass === "PRIOR_DEVELOPMENT_TOUCHED"),
    lockedAtMs: generatedAtMs,
  });
  const { outcomes, lifecycleRows } = runMatchedExitComparison(input);
  const splitManifest = buildPr05SplitManifest({ experimentManifest, rows: lifecycleRows });
  for (const row of outcomes) {
    row.split = resolveManifestSplit(row.manifestId, splitManifest);
  }
  const aggregates = buildSplitAggregates({
    outcomes,
    experimentManifest,
    comparisonType: "MATCHED_EXIT",
  });
  const negativeControl = runCausalEntryShiftNegativeControl({
    datasetId: input.datasetId,
    manifests: input.manifests,
    ticksByManifestId: input.ticksByManifestId,
    policyIds: input.policyIds ?? experimentManifest.exitPolicyIds,
    seed: experimentManifest.negativeControl.seed,
    iterations: 10,
  });
  const closedOutcomes = outcomes.filter((o) => o.closed && o.netPnl != null);
  const entryPrices = closedOutcomes.map((o) => {
    const manifest = lifecycleRows.find((r) => r.manifest.manifestId === o.manifestId)?.manifest;
    return manifest?.fills[0]?.price ?? null;
  }).filter((price): price is number => price != null);
  const costStress = runCostStressEvaluation({
    baseNetPnls: closedOutcomes.map((o) => o.netPnl!),
    entryPrices,
  });
  const portfolio = runPortfolioReplay({
    datasetId: input.datasetId,
    lifecycleRows,
    policyId: experimentManifest.baselinePolicyId,
    ticksByManifestId: input.ticksByManifestId,
    startingCapital: experimentManifest.startingCapital,
    maxConcurrentPositions: 1,
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
    portfolioOutcomes: portfolio.outcomes,
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
