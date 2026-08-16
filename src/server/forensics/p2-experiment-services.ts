import { createHash } from "node:crypto";
import type {
  FeeEdgeExperimentClass,
  FeeAwareEntryExperimentReport,
  PromotionGateStatus,
  StrategyComparisonReport,
} from "@/src/server/forensics/forensic.types";
import { evaluatePromotionGate } from "@/src/server/forensics/promotion-gate.service";
import {
  compareStrategyConfigurations,
  type StrategyComparisonInputRow,
} from "@/src/server/forensics/strategy-comparison-harness.service";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function classifyFeeEdgeExperiment(ratio: number, expectedNet: number): FeeEdgeExperimentClass {
  if (!Number.isFinite(ratio) || !Number.isFinite(expectedNet)) return "FEE_EROSION";
  if (expectedNet <= 0 || ratio < 1) return "FEE_EROSION";
  if (ratio < 1.5) return "FEE_BORDERLINE";
  return "FEE_SAFE";
}

export function buildFeeAwareEntryExperiment(input: {
  rows: StrategyComparisonInputRow[];
}): FeeAwareEntryExperimentReport {
  const classificationSummary: Partial<Record<FeeEdgeExperimentClass, number>> = {};
  for (const row of input.rows) {
    if (!row.feeMetrics) continue;
    const cls = classifyFeeEdgeExperiment(
      row.feeMetrics.expectedGrossToFeeRatio,
      row.feeMetrics.expectedNetAfterFeesAtTp,
    );
    classificationSummary[cls] = (classificationSummary[cls] ?? 0) + 1;
  }

  const comparison = compareStrategyConfigurations({
    rows: input.rows,
    baseline: { label: "baseline-no-fee-floor", policyFlags: {} },
    candidate: { label: "fee-aware-floor", policyFlags: { feeFloor: true } },
    evidenceRefs: ["P0 fee-edge metrics", "P2 fee-aware entry experiment"],
  });

  const promotion = evaluatePromotionGate({
    changeId: "fee-aware-entry-v1",
    description: "Fee-aware entry protection experiment (blocking disabled in production)",
    before: comparison.baseline.metrics,
    after: comparison.candidate.metrics,
    sampleSize: comparison.baseline.metrics.sampleSize,
    minSampleSize: 20,
    acceptanceTest: "tests/forensics/p2-profitability-optimization.test.ts",
  });

  const report: FeeAwareEntryExperimentReport = {
    generatedAt: new Date().toISOString(),
    baseline: comparison.baseline.metrics,
    experiment: comparison.candidate.metrics,
    delta: comparison.delta,
    classificationSummary,
    promotionStatus: promotion.status as PromotionGateStatus,
    blockingEnabledInProduction: false,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash({
    baseline: report.baseline,
    experiment: report.experiment,
    classificationSummary,
  });
  return report;
}

export function buildEntryTimingExperiment(input: {
  rows: StrategyComparisonInputRow[];
}): import("@/src/server/forensics/forensic.types").EntryTimingExperimentReport {
  const comparison = compareStrategyConfigurations({
    rows: input.rows,
    baseline: { label: "CURRENT_ENTRY", policyFlags: {} },
    candidate: { label: "CONTROLLED_ENTRY_PROTECTION", policyFlags: { entryTimingProtection: true } },
    evidenceRefs: ["P1 entry timing forensics"],
  });

  const lateEntryCount = input.rows.filter((row) => row.entryTiming?.classification === "POSSIBLY_LATE").length;

  const promotion = evaluatePromotionGate({
    changeId: "entry-timing-protection-v1",
    description: "Block POSSIBLY_LATE entries in offline experiment",
    before: comparison.baseline.metrics,
    after: comparison.candidate.metrics,
    sampleSize: comparison.baseline.metrics.sampleSize,
    minSampleSize: 20,
    acceptanceTest: "tests/forensics/p2-profitability-optimization.test.ts",
  });

  return {
    generatedAt: new Date().toISOString(),
    baselineLabel: "CURRENT_ENTRY",
    experimentLabel: "CONTROLLED_ENTRY_PROTECTION",
    baseline: comparison.baseline.metrics,
    experiment: comparison.candidate.metrics,
    delta: comparison.delta,
    lateEntryCount,
    promotionStatus: promotion.status as PromotionGateStatus,
    deterministicHash: deterministicHash({
      baseline: comparison.baseline.metrics,
      experiment: comparison.candidate.metrics,
      lateEntryCount,
    }),
  };
}

export function buildSingleChangeExperiment(input: {
  rows: StrategyComparisonInputRow[];
  experimentId: string;
  baselineLabel: string;
  candidateLabel: string;
  policyFlags: import("@/src/server/forensics/forensic.types").StrategyComparisonPolicyFlags;
}): StrategyComparisonReport {
  return compareStrategyConfigurations({
    rows: input.rows,
    baseline: { label: input.baselineLabel, policyFlags: {} },
    candidate: { label: input.candidateLabel, policyFlags: input.policyFlags },
    evidenceRefs: [`experiment=${input.experimentId}`],
  });
}
