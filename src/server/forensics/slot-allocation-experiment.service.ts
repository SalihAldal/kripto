import { createHash } from "node:crypto";
import type {
  ForensicSessionContext,
  PromotionGateStatus,
  SlotAllocationExperimentReport,
  StrategyComparisonMetrics,
} from "@/src/server/forensics/forensic.types";
import { evaluatePromotionGate } from "@/src/server/forensics/promotion-gate.service";
import { computeStrategyComparisonMetrics } from "@/src/server/forensics/strategy-comparison-harness.service";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function simulateSlotSelection(input: {
  session: ForensicSessionContext;
  maxPositions: number;
}): StrategyComparisonMetrics & { capitalUtilization: number; missedOpportunities: number; riskExposure: number } {
  const ranked = [...input.session.candidates].sort(
    (a, b) => Number(a.ranking ?? 999) - Number(b.ranking ?? 999),
  );
  const selectedSymbols = new Set(
    ranked.slice(0, input.maxPositions).map((row) => row.symbol.toUpperCase()),
  );
  const tradedPnls = input.session.pnlEntries.filter((row) => selectedSymbols.has(row.symbol.toUpperCase()));
  const metrics = computeStrategyComparisonMetrics(
    tradedPnls.map((row) => ({
      tradeId: row.tradeId,
      symbol: row.symbol,
      strategy: "SIMULATED",
      regime: "UNKNOWN",
      netPnL: row.netPnL,
      grossPnL: row.grossPnL,
      totalFee: row.totalFee,
    })),
  );
  const capitalUtilization = input.maxPositions > 0 ? selectedSymbols.size / input.maxPositions : 0;
  const missedOpportunities = Math.max(0, ranked.length - selectedSymbols.size);
  const riskExposure = selectedSymbols.size;
  return { ...metrics, capitalUtilization, missedOpportunities, riskExposure };
}

export function buildSlotAllocationExperiment(input: {
  session: ForensicSessionContext;
  baselineMaxPositions?: number;
  experimentMaxPositions?: number;
}): SlotAllocationExperimentReport {
  const baselineMaxPositions = input.baselineMaxPositions ?? 3;
  const experimentMaxPositions = input.experimentMaxPositions ?? 4;
  const baseline = simulateSlotSelection({ session: input.session, maxPositions: baselineMaxPositions });
  const experiment = simulateSlotSelection({ session: input.session, maxPositions: experimentMaxPositions });

  const promotion = evaluatePromotionGate({
    changeId: "slot-allocation-3-vs-4-v1",
    description: "Offline simulated slot allocation 3 vs 4 (no real risk increase)",
    before: baseline,
    after: experiment,
    sampleSize: baseline.sampleSize,
    minSampleSize: 20,
    acceptanceTest: "tests/forensics/p2-profitability-optimization.test.ts",
  });

  const report: SlotAllocationExperimentReport = {
    generatedAt: new Date().toISOString(),
    baselineLabel: `maxPositions=${baselineMaxPositions}`,
    experimentLabel: `maxPositions=${experimentMaxPositions}`,
    baselineMaxPositions,
    experimentMaxPositions,
    baseline,
    experiment,
    delta: {
      sampleSize: experiment.sampleSize - baseline.sampleSize,
      netPnL: Number((experiment.netPnL - baseline.netPnL).toFixed(4)),
      expectancy: Number((experiment.expectancy - baseline.expectancy).toFixed(4)),
      maxDrawdown: Number((experiment.maxDrawdown - baseline.maxDrawdown).toFixed(4)),
    },
    promotionStatus: promotion.status as PromotionGateStatus,
    note: "Offline simulation only; production maxPositions unchanged",
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash(report);
  return report;
}
