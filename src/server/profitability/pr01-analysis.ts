import {
  PR01_POLICY_VERSION,
  PR01_SCHEMA_VERSION,
  type MarketAnalysisResult,
  type Pr01AnalysisReport,
} from "@/src/server/profitability/pr01-types";
import { evaluatePointInTimeUniverse } from "@/src/server/profitability/pr01-universe";
import {
  buildMoveBucketReports,
  buildOpportunityLifecycleRecords,
  summarizeOpportunityCohorts,
} from "@/src/server/profitability/pr01-opportunity-inventory";
import { buildTradeEconomicsRecord } from "@/src/server/profitability/pr01-economics";
import { decomposeLatencyTimeline } from "@/src/server/profitability/pr01-latency";
import type { MoverEvent, TrackedCandidate } from "@/src/server/shadow-outcome/types";
import type { FunnelEvent } from "@/src/server/forensics/er01-telemetry-verdict";

export type Pr01OfflineAnalysisInput = {
  inspectedHead?: string | null;
  worktreeFingerprintSha256?: string | null;
  hasRecordedMarketData: boolean;
  trackedCandidates: TrackedCandidate[];
  movers: MoverEvent[];
  funnelEvents?: FunnelEvent[];
  universeRows?: Array<{
    symbol: string;
    asOfMs: number;
    executableSymbols: Set<string>;
    symbolRules?: { tickSize: number; stepSize: number; minQty: number; minNotional: number };
    intendedQuantity?: number;
    intendedPrice?: number;
    historicalListingKnown?: boolean;
  }>;
  enterCandidateIds?: Set<string>;
  executedCandidateIds?: Set<string>;
  openBlockers?: string[];
};

export function runPr01OfflineAnalysis(input: Pr01OfflineAnalysisInput): Pr01AnalysisReport {
  const openBlockers = [...(input.openBlockers ?? [])];
  const marketAnalysisResult: MarketAnalysisResult = input.hasRecordedMarketData ? "PARTIAL" : "NOT_RUN";
  if (!input.hasRecordedMarketData) {
    openBlockers.push("PR01-DATA-NO_RECORDED_MARKET_DATA");
  }

  const universeRecords = (input.universeRows ?? []).map((row) =>
    evaluatePointInTimeUniverse({
      symbol: row.symbol,
      asOfMs: row.asOfMs,
      executableSymbols: row.executableSymbols,
      symbolRules: row.symbolRules ?? null,
      intendedQuantity: row.intendedQuantity ?? null,
      intendedPrice: row.intendedPrice ?? null,
      historicalListingKnown: row.historicalListingKnown,
    }),
  );

  const lifecycleRecords = buildOpportunityLifecycleRecords({
    trackedCandidates: input.trackedCandidates,
    movers: input.movers,
    funnelEvents: input.funnelEvents,
    enterCandidateIds: input.enterCandidateIds,
    executedCandidateIds: input.executedCandidateIds,
  });
  const cohorts = summarizeOpportunityCohorts(lifecycleRecords);

  const economicsRecords = input.trackedCandidates.map((row) =>
    buildTradeEconomicsRecord({
      candidateId: row.snapshot.candidateId,
      symbol: row.snapshot.symbol,
      quoteCurrency: row.snapshot.symbol.endsWith("TRY") ? "TRY" : "USDT",
      decisionAtMs: row.snapshot.firstDetectedAt,
      entryPrice: row.snapshot.firstDetectionPrice,
      intendedQuantity: 1,
      expectedMovePercent: null,
      expectedMoveSource: "NOT_USED",
      costSource: "CONFIGURED_ASSUMPTION",
      takerFeeRate: 0.001,
      takeProfitPercent: 2,
      mfePct: row.outcomes.find((o) => o.horizonMin === 60)?.mfePct ?? null,
    }),
  );

  const breakEvenMap = new Map(
    economicsRecords.map((row) => [row.candidateId ?? "", row.moveViability.breakEvenMovePct]),
  );
  const moveBuckets = buildMoveBucketReports({
    movers: input.movers,
    tracked: input.trackedCandidates,
    economicsBreakEvenPct: breakEvenMap,
  });

  const latencyObservations = (input.funnelEvents ?? []).length
    ? decomposeLatencyTimeline({
        firstDetectedAtMs: input.trackedCandidates[0]?.snapshot.firstDetectedAt ?? null,
        strategySignalAtMs: null,
        canonicalDecisionAtMs: null,
      })
    : [];

  const costCoverageUnknown = economicsRecords.filter((row) => row.costCoverage.level === "UNKNOWN").length;
  const moveViabilityPass = economicsRecords.filter((row) => row.moveViability.status === "PASS").length;
  const moveViabilityFail = economicsRecords.filter((row) => row.moveViability.status === "FAIL").length;
  const expectancyProven = economicsRecords.filter((row) => row.expectancy.status === "PROVEN").length;
  const expectancyUnknown = economicsRecords.filter((row) => row.expectancy.status === "UNKNOWN").length;
  const realizedObserved = economicsRecords.filter((row) => row.realizedNet.status === "OBSERVED").length;

  const universeExecutable = universeRecords.filter((row) => row.eligibilityVerdict === "EXECUTABLE").length;
  const universeNotExecutable = universeRecords.filter((row) => row.eligibilityVerdict === "NOT_EXECUTABLE").length;
  const universeHistoricalUnknown = universeRecords.filter(
    (row) => row.eligibilityVerdict === "HISTORICAL_ELIGIBILITY_UNKNOWN",
  ).length;

  const engineeringVerdict =
    openBlockers.some((row) => row.startsWith("PR01-DATA")) && economicsRecords.length === 0
      ? "PARTIAL"
      : "PARTIAL";

  return {
    schemaVersion: PR01_SCHEMA_VERSION,
    policyVersion: PR01_POLICY_VERSION,
    generatedAt: new Date().toISOString(),
    inspectedHead: input.inspectedHead ?? null,
    worktreeFingerprintSha256: input.worktreeFingerprintSha256 ?? null,
    marketAnalysisResult,
    expectancyEvidenceStatus: expectancyProven > 0 ? "PROVEN" : "NOT_EVALUATED",
    universe: {
      evaluatedCount: universeRecords.length,
      executableCount: universeExecutable,
      notExecutableCount: universeNotExecutable,
      historicalUnknownCount: universeHistoricalUnknown,
    },
    opportunityCohorts: cohorts,
    latency: {
      observedSegmentCount: latencyObservations.filter((row) => row.status === "OBSERVED").length,
      missingSegmentCount: latencyObservations.filter((row) => row.status === "MISSING").length,
      invalidSegmentCount: latencyObservations.filter((row) => row.status === "INVALID").length,
    },
    economics: {
      costCoverageMeasured: economicsRecords.filter((row) => row.costCoverage.level === "MEASURED").length,
      costCoverageUnknown,
      moveViabilityPass,
      moveViabilityFail,
      expectancyProven,
      expectancyUnknown,
      realizedObserved,
    },
    moveBuckets,
    openBlockers,
    verdicts: {
      PROMPT7_ENGINEERING_VERDICT: engineeringVerdict,
      UNIVERSE_COVERAGE_VERDICT: universeRecords.length > 0 ? "PARTIAL" : input.hasRecordedMarketData ? "PARTIAL" : "NOT_RUN",
      OPPORTUNITY_ATTRIBUTION_VERDICT: lifecycleRecords.length > 0 ? "PARTIAL" : input.hasRecordedMarketData ? "PARTIAL" : "NOT_RUN",
      COST_MODEL_CORRECTNESS_VERDICT: moveViabilityPass + moveViabilityFail > 0 ? "PASS" : "PARTIAL",
      MARKET_ANALYSIS_RESULT: marketAnalysisResult,
      EXPECTANCY_EVIDENCE_STATUS: expectancyProven > 0 ? "PROVEN" : "NOT_EVALUATED",
      OVERALL_QA_STATUS: "QA_PENDING",
      PAPER_CAMPAIGN_STARTED: false,
      LIVE_AUTHORIZATION: "DISABLED",
      STRATEGY_PROMOTION: "NOT_EVALUATED",
    },
  };
}
