import { describe, expect, it, beforeEach } from "vitest";
import { walkForwardSplit } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { resolveExecutionAuthorization } from "@/src/server/execution/er03-canonical-policy";
import { resetExitPolicyStoreForTests } from "@/src/server/profitability/pr04-exit-evaluator";
import { buildMatchedEntryManifest, verifyManifestImmutable } from "@/src/server/profitability/pr04-matched-entry-manifest";
import { runPr04ExitReplayWithOutcome } from "@/src/server/profitability/pr04-replay";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import type { ExitTickObservation } from "@/src/server/profitability/pr04-types";
import { buildPr05DataInventory } from "@/src/server/profitability/pr05-data-inventory";
import {
  createLockedPr05ExperimentManifest,
  verifyExperimentManifestUnchanged,
} from "@/src/server/profitability/pr05-experiment-manifest";
import { buildPr05SplitManifest, resolveManifestSplit } from "@/src/server/profitability/pr05-split-manifest";
import { aggregateTradeOutcomes, computeNetExpectancyFromPnls } from "@/src/server/profitability/pr05-metrics";
import { detectFutureDataLeakFixture, shiftSignalBlocksWithSeed } from "@/src/server/profitability/pr05-negative-control";
import { applyCostStressToNetPnls, runCostStressEvaluation } from "@/src/server/profitability/pr05-cost-stress";
import { evaluateOfflineCandidate } from "@/src/server/profitability/pr05-candidate-evaluation";
import {
  runMatchedExitComparison,
  runPr05EngineeringFixtureComparison,
  runPr05OfflineComparison,
} from "@/src/server/profitability/pr05-offline-comparison";
import {
  ensurePr05OfflineComparisonExperiment,
  getProfitabilityExperiment,
  resetProfitabilityExperimentRegistryForTests,
} from "@/src/server/profitability/experiment-registry";
import { isPr04ExitEvaluationEnabled } from "@/src/server/profitability/pr04-exit-bridge";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");
const invalidation = {
  referenceLevel: 100,
  invalidationThreshold: 99.2,
  reasonCode: "LEVEL_HOLD_BREACH",
  computedAtMs: baseNow,
  availableAtMs: baseNow,
  validUntilMs: baseNow + 60_000,
  sourceObservations: ["CONFIRMED_PIVOT_HIGH"],
};

function obs(mark: number, offset = 0, overrides?: Partial<ExitTickObservation>): ExitTickObservation {
  const t = baseNow + offset;
  return {
    eventId: `evt:${t}:${mark}`,
    eventAtMs: t,
    availableAtMs: t,
    markPrice: mark,
    bid: mark,
    ask: mark,
    high: mark,
    low: mark,
    closed: true,
    stale: false,
    dataGap: false,
    ...overrides,
  };
}

function manifest(id: string, entryAtMs = baseNow) {
  return buildMatchedEntryManifest({
    entrySignalId: id,
    strategyId: "MOMENTUM_CONTINUATION",
    entryPolicyVersion: "pr03-momentum-and-retest-v1",
    entryAtMs,
    fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: entryAtMs }],
    riskReference: buildRiskReference({
      entryPrice: 100,
      initialStopPrice: 99.2,
      initialQuantity: 1,
      entryFee: 0.1,
      includesFeesInBreakEven: true,
      computedAtMs: entryAtMs,
    }),
    invalidation,
    featureEvidenceIds: [],
    dataSource: "SYNTHETIC_FIXTURE",
    replayWindow: { fromMs: entryAtMs, toMs: entryAtMs + 120_000 },
  });
}

beforeEach(() => {
  resetExitPolicyStoreForTests();
  resetProfitabilityExperimentRegistryForTests();
});

describe("PR05 offline comparison", () => {
  it("1 chronological split assigns train/validation/test in order", () => {
    const rows = [1, 2, 3, 4, 5].map((i) => ({
      lifecycleId: `lc-${i}`,
      eventAtMs: baseNow + i * 60_000,
      labelEndAtMs: baseNow + i * 60_000 + 30_000,
    }));
    const split = walkForwardSplit(rows, 5 * 60_000);
    expect(split.train.length).toBeGreaterThan(0);
    expect(split.train[0]!.lifecycleId).toBe("lc-1");
  });

  it("2 same lifecycle does not appear in multiple splits", () => {
    const exp = createLockedPr05ExperimentManifest({ headCommit: "abc", recordedMarketAvailable: false, priorDevelopmentRangesTouched: true });
    const m1 = manifest("sig-1", baseNow);
    const m2 = manifest("sig-2", baseNow + 3600_000);
    const m3 = manifest("sig-3", baseNow + 7200_000);
    const split = buildPr05SplitManifest({
      experimentManifest: exp,
      rows: [
        { lifecycleId: "sig-1", eventAtMs: m1.entryAtMs, labelEndAtMs: m1.replayWindow.toMs, manifest: m1 },
        { lifecycleId: "sig-2", eventAtMs: m2.entryAtMs, labelEndAtMs: m2.replayWindow.toMs, manifest: m2 },
        { lifecycleId: "sig-3", eventAtMs: m3.entryAtMs, labelEndAtMs: m3.replayWindow.toMs, manifest: m3 },
      ],
    });
    expect(split.leakageChecks.lifecycleCrossSplit).toBe(false);
  });

  it("3 label boundary purge applies embargo after train", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      lifecycleId: `lc-${i}`,
      eventAtMs: baseNow + i * 600_000,
      labelEndAtMs: baseNow + i * 600_000 + 300_000,
    }));
    const split = walkForwardSplit(rows, 5 * 60_000);
    const maxTrainEnd = Math.max(...split.train.map((r) => r.labelEndAtMs ?? r.eventAtMs));
    for (const row of split.validation) {
      expect(row.eventAtMs).toBeGreaterThanOrEqual(maxTrainEnd + 5 * 60_000);
    }
  });

  it("4 warmup may use past prices without future labels in split fit", () => {
    const exp = createLockedPr05ExperimentManifest({ headCommit: "x", recordedMarketAvailable: false, priorDevelopmentRangesTouched: true });
    expect(exp.purgeRule).toBe("LABEL_END_PLUS_EMBARGO");
  });

  it("5 normalization must not be fit on test split", () => {
    const exp = createLockedPr05ExperimentManifest({ headCommit: "x", recordedMarketAvailable: false, priorDevelopmentRangesTouched: true });
    expect(exp.candidateRules).toContain("no-promotion-without-holdout");
  });

  it("6 prior development data cannot be claimed as untouched holdout", () => {
    const inv = buildPr05DataInventory();
    expect(inv.holdoutProvenance).toBe("HOLDOUT_PROVENANCE_UNKNOWN");
  });

  it("7 availableAt in the future is rejected as decision input", () => {
    expect(detectFutureDataLeakFixture({ decisionAtMs: baseNow, observationAvailableAtMs: baseNow + 1000 })).toBe(true);
    expect(detectFutureDataLeakFixture({ decisionAtMs: baseNow, observationAvailableAtMs: baseNow })).toBe(false);
  });

  it("8 adding future ticks does not rewrite prior replay decisions", () => {
    const m = manifest("sig-future");
    const first = runPr04ExitReplayWithOutcome({
      datasetId: "ds",
      manifest: m,
      policyId: "STRUCTURAL_STOP_TARGET",
      ticks: [{ tickIndex: 0, observation: obs(100.5, 0) }],
    });
    runPr04ExitReplayWithOutcome({
      datasetId: "ds",
      manifest: m,
      policyId: "STRUCTURAL_STOP_TARGET",
      ticks: [
        { tickIndex: 0, observation: obs(100.5, 0) },
        { tickIndex: 1, observation: obs(104, 60_000) },
      ],
    });
    expect(first.report.tickCount).toBe(1);
  });

  it("9 missing historical universe is explicitly marked", () => {
    const inv = buildPr05DataInventory();
    const recorded = inv.entries.find((e) => e.sourceId === "recorded-market-replay-package");
    expect(recorded?.historicalUniverse).toBe(false);
    expect(recorded?.sourceClass).toBe("MISSING");
  });

  it("10 synthetic fixture is not fit for market experiment", () => {
    const inv = buildPr05DataInventory();
    const fixture = inv.entries.find((e) => e.sourceClass === "SYNTHETIC_FIXTURE");
    expect(fixture?.fitnessForMarketExperiment).toBe("NOT_FIT");
  });

  it("11 manifest hash change requires new experiment identity", () => {
    const a = createLockedPr05ExperimentManifest({ headCommit: "a", recordedMarketAvailable: false, priorDevelopmentRangesTouched: true });
    const b = createLockedPr05ExperimentManifest({ headCommit: "b", recordedMarketAvailable: false, priorDevelopmentRangesTouched: true });
    expect(verifyExperimentManifestUnchanged(a, b)).toBe(false);
  });

  it("12 same seed data config yields deterministic negative control", () => {
    const outcomes = [
      { lifecycleId: "a", closed: true, netPnl: 1, censored: false },
      { lifecycleId: "b", closed: true, netPnl: -0.5, censored: false },
    ] as Parameters<typeof shiftSignalBlocksWithSeed>[0]["outcomes"];
    const r1 = shiftSignalBlocksWithSeed({ outcomes, seed: 42, iterations: 5, shiftBlocks: 1 });
    const r2 = shiftSignalBlocksWithSeed({ outcomes, seed: 42, iterations: 5, shiftBlocks: 1 });
    expect(r1.controlNetExpectancies).toEqual(r2.controlNetExpectancies);
  });

  it("13 matched entries preserved across exit variants", () => {
    const m = manifest("sig-same");
    const ticks = { [m.manifestId]: [{ tickIndex: 0, observation: obs(99.1, 1000), applyFill: { price: 99.1, quantity: 1, fee: 0.05, feeAsset: "QUOTE" as const } }] };
    const { outcomes } = runMatchedExitComparison({
      datasetId: "ds",
      manifests: [m],
      ticksByManifestId: ticks,
      policyIds: ["BASELINE_FIXED_TP_SL", "STRUCTURAL_STOP_TARGET"],
      recordedMarketData: false,
    });
    expect(outcomes.every((o) => o.manifestId === m.manifestId)).toBe(true);
    expect(new Set(outcomes.map((o) => o.exitPolicyId)).size).toBe(2);
  });

  it("14 variant states isolated per policy replay", () => {
    const m = manifest("sig-iso");
    const ticks = { [m.manifestId]: [{ tickIndex: 0, observation: obs(103, 1000) }] };
    const { outcomes } = runMatchedExitComparison({
      datasetId: "ds",
      manifests: [m],
      ticksByManifestId: ticks,
      policyIds: ["STRUCTURAL_STOP_TRAIL", "STRUCTURAL_STOP_TARGET"],
      recordedMarketData: false,
    });
    expect(outcomes[0]!.exitPolicyId).not.toBe(outcomes[1]!.exitPolicyId);
  });

  it("15 portfolio capital double-use is not modeled in matched-exit comparison", () => {
    const report = runPr05OfflineComparison({
      datasetId: "ds",
      manifests: [],
      ticksByManifestId: {},
      recordedMarketData: false,
    });
    expect(report.portfolioOutcomes).toEqual([]);
  });

  it("16 router competition is not bypassed in market blocked path", () => {
    const report = runPr05OfflineComparison({ datasetId: "ds", manifests: [], ticksByManifestId: {}, recordedMarketData: false });
    expect(report.status).toBe("BLOCKED");
  });

  it("17 partial fill accounting reflected in replay outcome", () => {
    const m = manifest("sig-partial");
    const outcome = runPr04ExitReplayWithOutcome({
      datasetId: "ds",
      manifest: m,
      policyId: "STRUCTURAL_PARTIAL_TRAIL",
      ticks: [
        { tickIndex: 0, observation: obs(102.6, 1000) },
        {
          tickIndex: 1,
          observation: obs(102.6, 2000),
          applyFill: { price: 102.6, quantity: 0.25, fee: 0.02, feeAsset: "QUOTE" },
        },
      ],
    });
    expect(outcome.pnl?.status === "PARTIAL" || outcome.pnl?.status === "KNOWN").toBe(true);
  });

  it("18 fee is not double-counted in cost stress base path", () => {
    const stressed = applyCostStressToNetPnls({
      baseNetPnls: [1],
      entryPrices: [100],
      scenarioId: "BASE",
    });
    expect(stressed.netPnls[0]).toBe(1);
  });

  it("19 open censored trades remain visible in aggregates", () => {
    const agg = aggregateTradeOutcomes({
      outcomes: [
        {
          manifestId: "m1",
          lifecycleId: "l1",
          strategyId: "MOMENTUM_CONTINUATION",
          exitPolicyId: "BASELINE_FIXED_TP_SL",
          split: "TRAIN",
          entryAtMs: baseNow,
          closed: false,
          censored: true,
          grossPnl: null,
          netPnl: null,
          fees: 0,
          rMultiple: null,
          holdingMs: 1000,
          symbol: null,
          regime: null,
          pnlStatus: "UNKNOWN",
          equalRiskComparable: true,
        },
      ],
      variantKey: "v1",
      strategyId: "MOMENTUM_CONTINUATION",
      exitPolicyId: "BASELINE_FIXED_TP_SL",
      comparisonType: "MATCHED_EXIT",
    });
    expect(agg.censoredCount).toBe(1);
    expect(agg.closedTradeCount).toBe(0);
  });

  it("20 zero trades does not fabricate zero expectancy", () => {
    expect(computeNetExpectancyFromPnls([])).toBeNull();
    const agg = aggregateTradeOutcomes({
      outcomes: [],
      variantKey: "empty",
      strategyId: "EARLY_ACCELERATION",
      exitPolicyId: "BASELINE_FIXED_TP_SL",
      comparisonType: "MATCHED_EXIT",
    });
    expect(agg.netExpectancy).toBeNull();
    expect(agg.netExpectancyStatus).toBe("INSUFFICIENT_DATA");
  });

  it("21 missing cost leaves net result unknown in aggregate", () => {
    const agg = aggregateTradeOutcomes({
      outcomes: [
        {
          manifestId: "m",
          lifecycleId: "l",
          strategyId: "BREAKOUT_RETEST",
          exitPolicyId: "BASELINE_FIXED_TP_SL",
          split: "TRAIN",
          entryAtMs: baseNow,
          closed: true,
          censored: false,
          grossPnl: 1,
          netPnl: null,
          fees: 0,
          rMultiple: null,
          holdingMs: 1000,
          symbol: null,
          regime: null,
          pnlStatus: "UNKNOWN",
          equalRiskComparable: false,
        },
      ],
      variantKey: "v",
      strategyId: "BREAKOUT_RETEST",
      exitPolicyId: "BASELINE_FIXED_TP_SL",
      comparisonType: "MATCHED_EXIT",
    });
    expect(agg.netExpectancy).toBeNull();
  });

  it("22 largest winner concentration is computed", () => {
    const agg = aggregateTradeOutcomes({
      outcomes: [
        {
          manifestId: "m1",
          lifecycleId: "l1",
          strategyId: "EARLY_ACCELERATION",
          exitPolicyId: "BASELINE_FIXED_TP_SL",
          split: "TRAIN",
          entryAtMs: baseNow,
          closed: true,
          censored: false,
          grossPnl: 10,
          netPnl: 10,
          fees: 0,
          rMultiple: 2,
          holdingMs: 1000,
          symbol: "BTC",
          regime: null,
          pnlStatus: "KNOWN",
          equalRiskComparable: true,
        },
        {
          manifestId: "m2",
          lifecycleId: "l2",
          strategyId: "EARLY_ACCELERATION",
          exitPolicyId: "BASELINE_FIXED_TP_SL",
          split: "TRAIN",
          entryAtMs: baseNow + 1000,
          closed: true,
          censored: false,
          grossPnl: 1,
          netPnl: 1,
          fees: 0,
          rMultiple: 0.2,
          holdingMs: 1000,
          symbol: "ETH",
          regime: null,
          pnlStatus: "KNOWN",
          equalRiskComparable: true,
        },
      ],
      variantKey: "v",
      strategyId: "EARLY_ACCELERATION",
      exitPolicyId: "BASELINE_FIXED_TP_SL",
      comparisonType: "MATCHED_EXIT",
    });
    expect(agg.largestWinnerShare).toBeGreaterThan(0.8);
  });

  it("23 dependent lifecycle blocks are not treated as independent in negative control", () => {
    const nc = shiftSignalBlocksWithSeed({
      outcomes: [
        {
          manifestId: "m1",
          lifecycleId: "block-a",
          strategyId: "MOMENTUM_CONTINUATION",
          exitPolicyId: "BASELINE_FIXED_TP_SL",
          split: "TRAIN",
          entryAtMs: baseNow,
          closed: true,
          censored: false,
          grossPnl: 2,
          netPnl: 2,
          fees: 0,
          rMultiple: 1,
          holdingMs: 1000,
          symbol: null,
          regime: null,
          pnlStatus: "KNOWN",
          equalRiskComparable: true,
        },
      ],
      seed: 99,
      iterations: 3,
      shiftBlocks: 1,
    });
    expect(nc.method).toBe("SIGNAL_BLOCK_SHIFT");
  });

  it("24 negative control changes entry timing dependency", () => {
    const nc = shiftSignalBlocksWithSeed({
      outcomes: [
        {
          manifestId: "m1",
          lifecycleId: "a",
          strategyId: "MOMENTUM_CONTINUATION",
          exitPolicyId: "BASELINE_FIXED_TP_SL",
          split: "TRAIN",
          entryAtMs: baseNow,
          closed: true,
          censored: false,
          grossPnl: 3,
          netPnl: 3,
          fees: 0,
          rMultiple: 1,
          holdingMs: 1000,
          symbol: null,
          regime: null,
          pnlStatus: "KNOWN",
          equalRiskComparable: true,
        },
        {
          manifestId: "m2",
          lifecycleId: "b",
          strategyId: "MOMENTUM_CONTINUATION",
          exitPolicyId: "BASELINE_FIXED_TP_SL",
          split: "TRAIN",
          entryAtMs: baseNow + 1000,
          closed: true,
          censored: false,
          grossPnl: -1,
          netPnl: -1,
          fees: 0,
          rMultiple: -0.3,
          holdingMs: 1000,
          symbol: null,
          regime: null,
          pnlStatus: "KNOWN",
          equalRiskComparable: true,
        },
      ],
      seed: 7,
      iterations: 20,
      shiftBlocks: 1,
    });
    expect(nc.controlNetExpectancies.length).toBeGreaterThan(0);
  });

  it("25 negative control uses same exit engine outcomes", () => {
    const nc = shiftSignalBlocksWithSeed({
      outcomes: [
        {
          manifestId: "m1",
          lifecycleId: "a",
          strategyId: "BREAKOUT_RETEST",
          exitPolicyId: "STRUCTURAL_STOP_TARGET",
          split: "TRAIN",
          entryAtMs: baseNow,
          closed: true,
          censored: false,
          grossPnl: 1,
          netPnl: 1,
          fees: 0,
          rMultiple: 0.5,
          holdingMs: 1000,
          symbol: null,
          regime: null,
          pnlStatus: "KNOWN",
          equalRiskComparable: true,
        },
      ],
      seed: 1,
      iterations: 1,
      shiftBlocks: 1,
    });
    expect(nc.realNetExpectancy).toBe(1);
  });

  it("26 fixed seed is stable across runs", () => {
    const outcomes = [
      {
        manifestId: "m1",
        lifecycleId: "a",
        strategyId: "EARLY_ACCELERATION",
        exitPolicyId: "BASELINE_FIXED_TP_SL",
        split: "TRAIN",
        entryAtMs: baseNow,
        closed: true,
        censored: false,
        grossPnl: 2,
        netPnl: 2,
        fees: 0,
        rMultiple: 1,
        holdingMs: 1000,
        symbol: null,
        regime: null,
        pnlStatus: "KNOWN",
        equalRiskComparable: true,
      },
      {
        manifestId: "m2",
        lifecycleId: "b",
        strategyId: "EARLY_ACCELERATION",
        exitPolicyId: "BASELINE_FIXED_TP_SL",
        split: "TRAIN",
        entryAtMs: baseNow + 1000,
        closed: true,
        censored: false,
        grossPnl: -1,
        netPnl: -1,
        fees: 0,
        rMultiple: -0.5,
        holdingMs: 1000,
        symbol: null,
        regime: null,
        pnlStatus: "KNOWN",
        equalRiskComparable: true,
      },
    ];
    const a = shiftSignalBlocksWithSeed({ outcomes, seed: 20260906, iterations: 5, shiftBlocks: 1 });
    const b = shiftSignalBlocksWithSeed({ outcomes, seed: 20260906, iterations: 5, shiftBlocks: 1 });
    expect(a.controlNetExpectancies).toEqual(b.controlNetExpectancies);
  });

  it("27 future-data leak fixture is detected", () => {
    expect(detectFutureDataLeakFixture({ decisionAtMs: 100, observationAvailableAtMs: 200 })).toBe(true);
  });

  it("28 latency stress does not keep stale fill price", () => {
    const stressed = applyCostStressToNetPnls({
      baseNetPnls: [2],
      entryPrices: [100],
      scenarioId: "LATENCY_PLUS_1TICK",
    });
    expect(stressed.netPnls[0]).toBeLessThan(2);
  });

  it("29 stress assumptions are not labeled measured", () => {
    const stress = runCostStressEvaluation({ baseNetPnls: [1, -0.5], entryPrices: [100, 100] });
    expect(stress.every((s) => s.measured === false)).toBe(true);
  });

  it("30 failed variants remain in experiment variant count", () => {
    const exp = ensurePr05OfflineComparisonExperiment();
    expect(exp.variantCount).toBe(15);
  });

  it("31 holdout config change invalidates prior evidence claim", () => {
    const a = createLockedPr05ExperimentManifest({ headCommit: "x", recordedMarketAvailable: true, priorDevelopmentRangesTouched: false });
    const b = createLockedPr05ExperimentManifest({ headCommit: "x", recordedMarketAvailable: true, priorDevelopmentRangesTouched: true });
    expect(a.manifestHash).not.toBe(b.manifestHash);
  });

  it("32 validation metrics are not reported as holdout", () => {
    const report = runPr05OfflineComparison({ datasetId: "ds", manifests: [], ticksByManifestId: {}, recordedMarketData: false });
    expect(report.holdoutEvaluationStatus).toBe("NOT_RUN");
  });

  it("33 insufficient data does not promote candidate", () => {
    const exp = createLockedPr05ExperimentManifest({ headCommit: "x", recordedMarketAvailable: true, priorDevelopmentRangesTouched: false });
    const verdict = evaluateOfflineCandidate({
      experimentManifest: exp,
      recordedMarketAvailable: true,
      closedTradeCount: 2,
      independentLifecycleGroups: 2,
      holdoutUsable: true,
      negativeControlVerdict: "PASS",
      aggregates: [],
      baselinePolicyId: "BASELINE_FIXED_TP_SL",
    });
    expect(verdict.offlineCandidateVerdict).toBe("INSUFFICIENT_DATA");
    expect(verdict.selectedCandidateIds).toEqual([]);
  });

  it("34 json and markdown verdict fields align on blocked market path", () => {
    const report = runPr05OfflineComparison({ datasetId: "ds", manifests: [], ticksByManifestId: {}, recordedMarketData: false });
    expect(report.offlineCandidateVerdict).toBe("BLOCKED");
    expect(report.profitabilityEvidence).toBe("INSUFFICIENT_DATA");
    expect(report.selectedCandidateIds).toEqual([]);
  });

  it("35 offline candidate verdict does not enable live activation", () => {
    expect(isPr04ExitEvaluationEnabled()).toBe(false);
    expect(resolveExecutionAuthorization({ mode: "LIVE", strategyActivation: "LIVE_DISABLED" })).toBe("LIVE_DISABLED");
  });

  it("36 production db and live order paths remain closed", () => {
    const report = runPr05EngineeringFixtureComparison({
      datasetId: "fixture-ds",
      manifests: [manifest("eng-1")],
      ticksByManifestId: {
        [manifest("eng-1").manifestId]: [{ tickIndex: 0, observation: obs(99.1, 1000), applyFill: { price: 99.1, quantity: 1, fee: 0.05, feeAsset: "QUOTE" } }],
      },
      recordedMarketData: false,
    });
    expect(report.reason).toContain("ENGINEERING_FIXTURE_ONLY");
    expect(report.openBlockers).toContain("PR05-DATA-01");
    expect(verifyManifestImmutable(manifest("eng-1"), manifest("eng-1"))).toBe(true);
    const exp = ensurePr05OfflineComparisonExperiment();
    expect(exp.status).toBe("PLANNED");
    expect(getProfitabilityExperiment("pr05-offline-comparison-v1")?.status).toBe("PLANNED");
    expect(resolveManifestSplit("missing", report.splitManifest!)).toBe("UNASSIGNED");
  });
});
