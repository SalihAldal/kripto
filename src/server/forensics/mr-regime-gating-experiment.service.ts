import { createHash } from "node:crypto";
import type {
  ForensicRegimeClass,
  MeanReversionEntryRecord,
  MrRegimeGatingExperimentReport,
  PnlLedgerEntry,
  PromotionGateStatus,
} from "@/src/server/forensics/forensic.types";
import {
  buildStrategyComparisonInputRows,
  compareStrategyConfigurations,
  computeStrategyComparisonMetrics,
} from "@/src/server/forensics/strategy-comparison-harness.service";
import { isMeanReversionStrategy } from "@/src/server/forensics/mean-reversion-regime-audit.service";
import { evaluatePromotionGate } from "@/src/server/forensics/promotion-gate.service";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

const MR_FILTERED_REGIMES: ForensicRegimeClass[] = ["CHAOS", "HIGH_VOLATILITY", "TREND"];

function sampleConfidence(n: number): MrRegimeGatingExperimentReport["confidence"] {
  if (n >= 30) return "HIGH";
  if (n >= 15) return "MEDIUM";
  if (n >= 5) return "LOW";
  return "INSUFFICIENT";
}

export function buildMrRegimeGatingExperiment(input: {
  mrEntries: MeanReversionEntryRecord[];
  pnlEntries: PnlLedgerEntry[];
}): MrRegimeGatingExperimentReport {
  const mrTradeIds = new Set(
    input.mrEntries.filter((row) => row.tradeId && isMeanReversionStrategy(row.strategyId)).map((row) => row.tradeId!),
  );
  const mrPnl = input.pnlEntries.filter((row) => mrTradeIds.has(row.tradeId));
  const strategyByTradeId = Object.fromEntries(
    input.mrEntries.filter((row) => row.tradeId).map((row) => [row.tradeId!, row.strategyId]),
  );
  const regimeByTradeId = Object.fromEntries(
    input.mrEntries.filter((row) => row.tradeId).map((row) => [row.tradeId!, row.forensicRegime]),
  );

  const rows = buildStrategyComparisonInputRows({
    pnlEntries: mrPnl,
    strategyByTradeId,
    regimeByTradeId,
  });

  const baselineMetrics = computeStrategyComparisonMetrics(rows);
  const candidateRows = rows.filter((row) => !MR_FILTERED_REGIMES.includes(row.regime as ForensicRegimeClass));
  const candidateMetrics = computeStrategyComparisonMetrics(candidateRows);
  const missedOpportunities = rows.length - candidateRows.length;

  const comparison = compareStrategyConfigurations({
    rows,
    baseline: { label: "CURRENT_MR", policyFlags: {} },
    candidate: { label: "MR_WITH_REGIME_FILTER", policyFlags: { regimeGating: true } },
    evidenceRefs: ["P1 MR regime audit", "MR_WITH_REGIME_FILTER excludes CHAOS/HIGH_VOLATILITY/TREND"],
  });

  const promotion = evaluatePromotionGate({
    changeId: "mr-regime-gating-v1",
    description: "Exclude MR entries in CHAOS/HIGH_VOLATILITY/TREND regimes",
    before: baselineMetrics,
    after: candidateMetrics,
    sampleSize: baselineMetrics.sampleSize,
    minSampleSize: 20,
    acceptanceTest: "tests/forensics/p1-profitability-engineering.test.ts",
  });

  const report: MrRegimeGatingExperimentReport = {
    generatedAt: new Date().toISOString(),
    baselineLabel: "CURRENT_MR",
    candidateLabel: "MR_WITH_REGIME_FILTER",
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    delta: comparison.delta,
    filteredRegimes: MR_FILTERED_REGIMES,
    sampleSize: baselineMetrics.sampleSize,
    confidence: sampleConfidence(baselineMetrics.sampleSize),
    riskImpact: `maxDrawdown delta ${comparison.delta.maxDrawdown ?? 0}`,
    missedOpportunities,
    promotionStatus: promotion.status as PromotionGateStatus,
    deterministicHash: "",
  };
  report.deterministicHash = deterministicHash(report);
  return report;
}
