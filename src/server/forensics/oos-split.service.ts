import type {
  StrategyComparisonConfig,
  StrategyComparisonMetrics,
} from "@/src/server/forensics/forensic.types";
import {
  compareStrategyConfigurations,
  type StrategyComparisonInputRow,
} from "@/src/server/forensics/strategy-comparison-harness.service";

export function buildOutOfSampleEvaluation(input: {
  rows: StrategyComparisonInputRow[];
  baseline: StrategyComparisonConfig;
  candidate: StrategyComparisonConfig;
  minimumRows?: number;
}) {
  const minimumRows = input.minimumRows ?? 10;
  const sorted = [...input.rows].sort((a, b) =>
    String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
  );
  if (sorted.length < minimumRows) {
    return {
      available: false,
      reason: `Insufficient rows for OOS split (n=${sorted.length}, required=${minimumRows})`,
    };
  }
  const splitIndex = Math.max(1, Math.floor(sorted.length * 0.7));
  const inSampleRows = sorted.slice(0, splitIndex);
  const outOfSampleRows = sorted.slice(splitIndex);
  if (outOfSampleRows.length < Math.max(3, Math.floor(minimumRows * 0.2))) {
    return {
      available: false,
      reason: `Insufficient OOS rows (oos=${outOfSampleRows.length})`,
    };
  }

  const inSample = compareStrategyConfigurations({
    rows: inSampleRows,
    baseline: input.baseline,
    candidate: input.candidate,
    evidenceRefs: ["OOS_SPLIT_IN_SAMPLE"],
  });
  const outOfSample = compareStrategyConfigurations({
    rows: outOfSampleRows,
    baseline: input.baseline,
    candidate: input.candidate,
    evidenceRefs: ["OOS_SPLIT_OUT_OF_SAMPLE"],
  });

  return {
    available: true,
    split: { inSampleCount: inSampleRows.length, outOfSampleCount: outOfSampleRows.length },
    inSample: {
      baseline: inSample.baseline.metrics,
      candidate: inSample.candidate.metrics,
      delta: inSample.delta,
    },
    outOfSample: {
      baseline: outOfSample.baseline.metrics,
      candidate: outOfSample.candidate.metrics,
      delta: outOfSample.delta,
    },
    support: evaluateOosSupport(outOfSample.baseline.metrics, outOfSample.candidate.metrics),
  };
}

function evaluateOosSupport(before: StrategyComparisonMetrics, after: StrategyComparisonMetrics) {
  const expectancyImproved = after.expectancy > before.expectancy;
  const drawdownSafe = after.maxDrawdown <= before.maxDrawdown * 1.1;
  return {
    expectancyImproved,
    drawdownSafe,
    supported: expectancyImproved && drawdownSafe,
  };
}
