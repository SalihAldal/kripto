import type { ForensicRegimeClass, ForensicSessionContext, P2ForensicSessionBundle } from "@/src/server/forensics/forensic.types";
import { buildAiStrategyInteractionReport } from "@/src/server/forensics/ai-strategy-interaction.service";
import { buildCanonicalBaseline } from "@/src/server/forensics/baseline-metrics.service";
import { buildCandidateQualityFactorAnalysis } from "@/src/server/forensics/candidate-quality-factor-analysis.service";
import { buildExperimentRegistry } from "@/src/server/forensics/experiment-registry.service";
import { evaluateFeeAwareEntryPolicy } from "@/src/server/forensics/fee-aware-entry-policy.service";
import { buildFeeMetricsBySymbol } from "@/src/server/forensics/fee-aware-edge-research.service";
import { buildOpportunityValueReport } from "@/src/server/forensics/opportunity-value.service";
import { buildOutOfSampleEvaluation } from "@/src/server/forensics/oos-split.service";
import {
  buildEntryTimingExperiment,
  buildFeeAwareEntryExperiment,
  buildSingleChangeExperiment,
} from "@/src/server/forensics/p2-experiment-services";
import { buildP1ForensicReports } from "@/src/server/forensics/p1-forensic-report.service";
import { evaluatePromotionGate, buildStrategyRegimeMatrix } from "@/src/server/forensics/promotion-gate.service";
import { buildSlotAllocationAnalysis } from "@/src/server/forensics/slot-allocation-analysis.service";
import { buildSlotAllocationExperiment } from "@/src/server/forensics/slot-allocation-experiment.service";
import { buildSlotOpportunityReport } from "@/src/server/forensics/slot-opportunity-report.service";
import {
  buildStrategyComparisonInputRows,
  compareStrategyConfigurations,
  filterRowsWithoutLookAhead,
} from "@/src/server/forensics/strategy-comparison-harness.service";
import { buildTdiSensitivityReport } from "@/src/server/forensics/tdi-sensitivity.service";
import { buildTrendFollowingValidation } from "@/src/server/forensics/trend-following-analysis.service";
import { buildVolatilityBreakoutValidationReport } from "@/src/server/forensics/volatility-breakout-validation.service";
import { buildProfitConcentrationReport } from "@/src/server/forensics/profit-concentration.service";

const ACCEPTANCE_TEST = "tests/forensics/p2-profitability-optimization.test.ts";

function resolveTradeMaps(session: ForensicSessionContext) {
  const strategyByTradeId: Record<string, string> = {};
  const regimeByTradeId: Record<string, ForensicRegimeClass | string> = {};
  for (const entry of session.meanReversionEntries ?? []) {
    if (entry.tradeId) {
      strategyByTradeId[entry.tradeId] = entry.strategyId;
      regimeByTradeId[entry.tradeId] = entry.forensicRegime;
    }
  }
  for (const pnl of session.pnlEntries) {
    if (!strategyByTradeId[pnl.tradeId]) {
      const mr = (session.meanReversionEntries ?? []).find((row) => row.tradeId === pnl.tradeId);
      if (mr) {
        strategyByTradeId[pnl.tradeId] = mr.strategyId;
        regimeByTradeId[pnl.tradeId] = mr.forensicRegime;
      }
    }
  }
  const entryTimingBySymbol = Object.fromEntries(
    (session.entryTimingRecords ?? []).map((row) => [row.symbol.toUpperCase(), row]),
  );
  const tdiBySymbol = Object.fromEntries(
    (session.tdiDecisions ?? []).map((row) => [row.symbol.toUpperCase(), row]),
  );
  return { strategyByTradeId, regimeByTradeId, entryTimingBySymbol, tdiBySymbol };
}

export function buildP2ForensicReports(session: ForensicSessionContext): P2ForensicSessionBundle {
  const p1 = buildP1ForensicReports(session);
  const { strategyByTradeId, regimeByTradeId, entryTimingBySymbol, tdiBySymbol } = resolveTradeMaps(session);
  const feeMetricsBySymbol = buildFeeMetricsBySymbol(session.decisions);

  const postEntryMoves: Record<string, number> = {};
  for (const row of session.notDiscoveredRecords ?? []) {
    if (row.subsequentMovePercent !== undefined) {
      postEntryMoves[row.symbol.toUpperCase()] = row.subsequentMovePercent;
    }
  }

  const slotOpportunity = buildSlotOpportunityReport({ session });
  const slotAllocationAnalysis = buildSlotAllocationAnalysis({ session, postEntryMovesBySymbol: postEntryMoves });
  const slotAllocationExperiment = buildSlotAllocationExperiment({ session });
  const tdiSensitivity = buildTdiSensitivityReport({ session });

  const comparisonRows = filterRowsWithoutLookAhead(
    buildStrategyComparisonInputRows({
      pnlEntries: session.pnlEntries,
      strategyByTradeId,
      regimeByTradeId,
      tdiBySymbol,
      feeMetricsBySymbol,
      entryTimingBySymbol,
    }),
  );

  const strategyComparison = compareStrategyConfigurations({
    rows: comparisonRows,
    baseline: { label: "BASELINE", policyFlags: {} },
    candidate: {
      label: "MULTI_CHANGE_RESEARCH_ONLY",
      policyFlags: { regimeGating: true, feeFloor: true, entryTimingProtection: true },
    },
    evidenceRefs: ["P2 combined research bundle — not for production promotion"],
  });
  const baselineMetrics = buildCanonicalBaseline({ pnlEntries: session.pnlEntries });

  const mrRegimeExperiment = buildSingleChangeExperiment({
    rows: comparisonRows,
    experimentId: "mr-regime-filter",
    baselineLabel: "BASELINE",
    candidateLabel: "MR_REGIME_FILTER",
    policyFlags: { regimeGating: true },
  });
  const breakoutRegimeExperiment = buildSingleChangeExperiment({
    rows: comparisonRows.filter((row) => row.strategy.toUpperCase().includes("BREAKOUT") || row.strategy.toUpperCase().includes("MOMENTUM")),
    experimentId: "breakout-regime-preference",
    baselineLabel: "BASELINE",
    candidateLabel: "BREAKOUT_REGIME_FILTER",
    policyFlags: { regimeGating: true },
  });

  const feeAwareEntryExperiment = buildFeeAwareEntryExperiment({ rows: comparisonRows });
  const entryTimingExperiment = buildEntryTimingExperiment({ rows: comparisonRows });
  const strategyRegimeMatrix = buildStrategyRegimeMatrix({
    pnlEntries: session.pnlEntries,
    strategyByTradeId,
    regimeByTradeId,
  });

  const volatilityBreakout = buildVolatilityBreakoutValidationReport({
    strategies: p1.strategyPerformance?.strategies ?? [],
    regimeMatrix: strategyRegimeMatrix,
  });

  const aiStrategyInteraction = buildAiStrategyInteractionReport({
    session,
    strategyByTradeId,
    regimeByTradeId: regimeByTradeId as Record<string, string>,
  });

  const opportunityValue = buildOpportunityValueReport({
    session,
    postEntryMovesBySymbol: postEntryMoves,
  });

  const feePolicySamples = (session.feePolicyEvaluations ?? []).slice(0, 50);
  const candidateQualityFactors = buildCandidateQualityFactorAnalysis({
    rows: comparisonRows,
    tdiBySymbol,
    entryTimingBySymbol,
    feeMetricsBySymbol,
  });
  const trendFollowingValidation = buildTrendFollowingValidation({
    strategyPerformance: p1.strategyPerformance,
  });
  const outOfSampleEvaluation = buildOutOfSampleEvaluation({
    rows: comparisonRows,
    baseline: { label: "BASELINE", policyFlags: {} },
    candidate: { label: mrRegimeExperiment.candidate.label, policyFlags: mrRegimeExperiment.candidate.policyFlags },
  });
  const profitConcentration = buildProfitConcentrationReport({ rows: comparisonRows });

  const promotionGate = evaluatePromotionGate({
    changeId: "p2-single-change-mr-regime-filter",
    description: "Single-change P2 candidate (MR regime filter) — no auto-promotion",
    before: mrRegimeExperiment.baseline.metrics,
    after: mrRegimeExperiment.candidate.metrics,
    sampleSize: mrRegimeExperiment.baseline.metrics.sampleSize,
    minSampleSize: 20,
    acceptanceTest: ACCEPTANCE_TEST,
    outOfSampleSupport: outOfSampleEvaluation.available ? outOfSampleEvaluation.support : null,
    topSymbolContributionPct: profitConcentration.available ? profitConcentration.topSymbolContributionPct : undefined,
    top1TradeContributionPct: profitConcentration.available ? profitConcentration.top1TradeContributionPct : undefined,
  });

  const promotionDecisions = [
    {
      changeId: "slot-allocation-3-vs-4",
      status: slotAllocationExperiment.promotionStatus,
      reason: slotAllocationExperiment.note,
    },
    {
      changeId: "fee-aware-entry-v1",
      status: feeAwareEntryExperiment.promotionStatus,
      reason: "Blocking disabled in production",
    },
    {
      changeId: "entry-timing-protection-v1",
      status: entryTimingExperiment.promotionStatus,
      reason: "Offline POSSIBLY_LATE filter only",
    },
    {
      changeId: "tdi-threshold-sensitivity",
      status: tdiSensitivity.recommendation === "NO_CHANGE" ? "RESEARCH_ONLY" as const : "REJECTED" as const,
      reason: `Recommendation=${tdiSensitivity.recommendation}`,
    },
    {
      changeId: "volatility-breakout-followup",
      status: volatilityBreakout.sufficientData ? "RESEARCH_ONLY" as const : "REJECTED" as const,
      reason: volatilityBreakout.reasonDetail,
    },
  ];

  const experimentRegistry = buildExperimentRegistry({
    experiments: [
      {
        experimentId: "slot-3-vs-4",
        baseline: "maxPositions=3",
        variant: "maxPositions=4",
        hypothesis: "Higher slot count improves capital utilization without unacceptable drawdown",
        parameters: { baselineMax: 3, experimentMax: 4, offline: true },
        report: { baseline: { metrics: slotAllocationExperiment.baseline }, candidate: { metrics: slotAllocationExperiment.experiment } },
        promotionStatus: slotAllocationExperiment.promotionStatus,
        acceptanceTest: ACCEPTANCE_TEST,
      },
      {
        experimentId: "mr-regime-filter",
        baseline: "CURRENT_MR",
        variant: "MR_WITH_REGIME_FILTER",
        hypothesis: "MR performs better when CHAOS/HIGH_VOL/TREND excluded",
        parameters: { filteredRegimes: ["CHAOS", "HIGH_VOLATILITY", "TREND"] },
        report: mrRegimeExperiment,
        promotionStatus: p1.mrRegimeGatingExperiment?.promotionStatus ?? "RESEARCH_ONLY",
        acceptanceTest: ACCEPTANCE_TEST,
      },
      {
        experimentId: "breakout-regime-preference",
        baseline: "BASELINE",
        variant: "BREAKOUT_REGIME_FILTER",
        hypothesis: "Breakout candidates may require regime compatibility",
        parameters: { regimeGating: true, strategySubset: "BREAKOUT|MOMENTUM" },
        report: breakoutRegimeExperiment,
        promotionStatus: "RESEARCH_ONLY",
        acceptanceTest: ACCEPTANCE_TEST,
      },
      {
        experimentId: "fee-aware-entry",
        baseline: "no-fee-floor",
        variant: "fee-floor",
        hypothesis: "Fee-safe entries improve net expectancy",
        parameters: { blockingEnabled: false },
        report: { baseline: { metrics: feeAwareEntryExperiment.baseline }, candidate: { metrics: feeAwareEntryExperiment.experiment } },
        promotionStatus: feeAwareEntryExperiment.promotionStatus,
        acceptanceTest: ACCEPTANCE_TEST,
      },
      {
        experimentId: "entry-timing-protection",
        baseline: "CURRENT_ENTRY",
        variant: "CONTROLLED_ENTRY_PROTECTION",
        hypothesis: "Late entries degrade net expectancy",
        parameters: { blockClassification: "POSSIBLY_LATE" },
        report: { baseline: { metrics: entryTimingExperiment.baseline }, candidate: { metrics: entryTimingExperiment.experiment } },
        promotionStatus: entryTimingExperiment.promotionStatus,
        acceptanceTest: ACCEPTANCE_TEST,
      },
    ],
  });

  return {
    tdiDecisions: session.tdiDecisions ?? [],
    slotOpportunity,
    slotAllocationAnalysis,
    slotAllocationExperiment,
    tdiSensitivity,
    strategyComparison,
    singleChangeExperiments: [mrRegimeExperiment, breakoutRegimeExperiment],
    feePolicySamples,
    feeAwareEntryExperiment,
    entryTimingExperiment,
    volatilityBreakout,
    aiStrategyInteraction,
    opportunityValue,
    strategyRegimeMatrix,
    experimentRegistry,
    promotionGate,
    promotionDecisions,
    baselineMetrics,
    outOfSampleEvaluation,
    profitConcentration,
    candidateQualityFactors,
    trendFollowingValidation,
  };
}

export { evaluateFeeAwareEntryPolicy };
