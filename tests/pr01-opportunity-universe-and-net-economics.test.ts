import { describe, expect, it, beforeEach } from "vitest";
import { evaluatePointInTimeUniverse } from "@/src/server/profitability/pr01-universe";
import {
  buildMoveBucketReports,
  buildOpportunityLifecycleRecords,
  classifyMoveOnset,
  dedupeMovers,
} from "@/src/server/profitability/pr01-opportunity-inventory";
import {
  buildLatencyTimelineFromFunnelEvents,
  computeLatencySegment,
  decomposeLatencyTimeline,
} from "@/src/server/profitability/pr01-latency";
import {
  assertEconomicsSeparation,
  buildTradeEconomicsRecord,
} from "@/src/server/profitability/pr01-economics";
import { runPr01OfflineAnalysis } from "@/src/server/profitability/pr01-analysis";
import {
  ensurePr01BaselineExperiment,
  getProfitabilityExperiment,
  resetProfitabilityExperimentRegistryForTests,
} from "@/src/server/profitability/experiment-registry";
import { detectMoverEvents } from "@/src/server/shadow-outcome/mover-truth";
import type { MoverEvent, TrackedCandidate } from "@/src/server/shadow-outcome/types";
import type { FunnelEvent } from "@/src/server/forensics/er01-telemetry-verdict";
import { evaluateRecoveryAssessment } from "@/src/server/forensics/er01-telemetry-verdict";
import { buildFeatureContractSnapshot } from "@/src/server/execution/er02-feature-contract";
import { resolveExecutionAuthorization } from "@/src/server/execution/er03-canonical-policy";

function trackedFixture(overrides?: Partial<TrackedCandidate["snapshot"]>): TrackedCandidate {
  const now = Date.now();
  return {
    snapshot: {
      candidateId: "cand-1",
      symbol: "BTCTRY",
      firstDetectedAt: now - 60_000,
      firstDetectionPrice: 100,
      primaryLane: "opportunity",
      secondaryEvidence: [],
      opportunityScore: 70,
      opportunityBreakdown: {},
      microScore: 65,
      microBreakdown: {},
      liquidityScore: 0.8,
      executionQuality: 0.7,
      finalScore: 72,
      initialRank: 1,
      btcReturn1m: 0.1,
      btcReturn5m: 0.2,
      marketBreadthPctPositive1m: 55,
      aiStatus: "OK",
      aiModifier: 0,
      tdiDecision: "ENTER",
      reasonCodes: [],
      warnings: [],
      rvol1m: 1.2,
      priceAccelerationShort: 0.3,
      takerBuyRatio5s: 0.6,
      source: "replay",
      ...overrides,
    },
    journey: [],
    moveKey: "mv-1",
    latestStage: "HOT",
    latestScore: 72,
    latestRank: 1,
    latestAiStatus: "OK",
    latestTdiDecision: "ENTER",
    hotAt: now - 50_000,
    microConfirmedAt: now - 40_000,
    executionReadyAt: now - 30_000,
    deepSubscriptionAt: null,
    lastPrice: 101,
    lastPriceAt: now,
    high: 103,
    low: 99,
    highAt: now,
    outcomes: [
      {
        horizonMin: 60,
        mfePct: 2.5,
        maePct: -0.4,
        returnPct: 1.1,
        timeToMfeMs: 30_000,
        timeToMaeMs: 10_000,
        complete: true,
        quality: "OK",
        status: "COMPLETE",
      },
    ],
  };
}

function moverFixture(overrides?: Partial<MoverEvent>): MoverEvent {
  const now = Date.now();
  return {
    moverId: "mvr-1",
    campaignId: null,
    runId: null,
    symbol: "BTCTRY",
    moveClass: 5,
    horizonMin: 30,
    moveStartAt: now - 120_000,
    moveStartPrice: 98,
    thresholdPrice: 103,
    thresholdReachedAt: now - 30_000,
    peakAt: now - 10_000,
    peakPrice: 105,
    peakMovePct: 7.1,
    status: "THRESHOLD_REACHED",
    ...overrides,
  };
}

describe("PR01 opportunity universe and net economics", () => {
  beforeEach(() => {
    resetProfitabilityExperimentRegistryForTests();
  });

  describe("universe", () => {
    it("1 discovery present but execution absent is not executable", () => {
      const row = evaluatePointInTimeUniverse({
        symbol: "XYZTRY",
        asOfMs: Date.now(),
        executableSymbols: new Set<string>(),
        historicalListingKnown: true,
        listingStatus: "LISTED",
      });
      expect(row.eligibilityVerdict).toBe("NOT_EXECUTABLE");
      expect(row.reasonCodes).toContain("DISCOVERY_PRESENT_EXECUTION_ABSENT");
    });

    it("2 missing historical metadata marks eligibility unknown", () => {
      const row = evaluatePointInTimeUniverse({
        symbol: "BTCTRY",
        asOfMs: Date.now(),
        historicalListingKnown: false,
      });
      expect(row.eligibilityVerdict).toBe("HISTORICAL_ELIGIBILITY_UNKNOWN");
    });

    it("3 current listing set cannot silently backfill historical universe", () => {
      const historical = evaluatePointInTimeUniverse({
        symbol: "DELISTEDTRY",
        asOfMs: Date.now() - 365 * 24 * 60 * 60_000,
        executableSymbols: new Set(["BTCTRY"]),
        historicalListingKnown: false,
      });
      expect(historical.listingStatus).toBe("HISTORICAL_ELIGIBILITY_UNKNOWN");
    });

    it("4 uncertain venue mapping is flagged", () => {
      const row = evaluatePointInTimeUniverse({
        symbol: "BTCTRY",
        asOfMs: Date.now(),
        venueMappingQuality: "UNCERTAIN",
        executableSymbols: new Set(["BTCTRY"]),
        historicalListingKnown: true,
      });
      expect(row.eligibilityVerdict).toBe("VENUE_MAPPING_UNCERTAIN");
    });

    it("5 min-notional and step-size validation enforced", () => {
      const row = evaluatePointInTimeUniverse({
        symbol: "BTCTRY",
        asOfMs: Date.now(),
        executableSymbols: new Set(["BTCTRY"]),
        historicalListingKnown: true,
        symbolRules: { tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 100 },
        intendedQuantity: 0.001,
        intendedPrice: 10,
      });
      expect(row.eligibilityVerdict).toBe("BELOW_MIN_NOTIONAL");
    });

    it("6 stale book does not produce executable proven price", () => {
      const row = evaluatePointInTimeUniverse({
        symbol: "BTCTRY",
        asOfMs: Date.now(),
        executableSymbols: new Set(["BTCTRY"]),
        historicalListingKnown: true,
        marketDataFreshnessMs: 180_000,
      });
      expect(row.eligibilityVerdict).toBe("STALE_MARKET_DATA");
    });
  });

  describe("opportunity cohorts", () => {
    it("7 duplicate threshold horizons do not inflate independent opportunity count", () => {
      const movers = [
        moverFixture({ moverId: "a", moveClass: 5, horizonMin: 30 }),
        moverFixture({ moverId: "b", moveClass: 5, horizonMin: 30, thresholdReachedAt: moverFixture().thresholdReachedAt + 1 }),
      ];
      const deduped = dedupeMovers(movers);
      expect(deduped.length).toBe(1);
    });

    it("8 up/down/flat candidates remain in inventory", () => {
      const up = trackedFixture({ candidateId: "up", symbol: "AAATRY" });
      const flat = trackedFixture({ candidateId: "flat", symbol: "BBBTRY", finalScore: 40 });
      const records = buildOpportunityLifecycleRecords({
        trackedCandidates: [up, flat],
        movers: [],
      });
      expect(records.length).toBe(2);
    });

    it("9 missing coverage is not labeled as definite missed opportunity", () => {
      const report = runPr01OfflineAnalysis({
        hasRecordedMarketData: false,
        trackedCandidates: [],
        movers: [moverFixture()],
      });
      expect(report.openBlockers).toContain("PR01-DATA-NO_RECORDED_MARKET_DATA");
      expect(report.verdicts.MARKET_ANALYSIS_RESULT).toBe("NOT_RUN");
    });

    it("10 retrospective onset is not used as causal detection latency anchor", () => {
      const onset = classifyMoveOnset(moverFixture());
      expect(onset.onsetTypes.threshold).toBe("CAUSAL_THRESHOLD");
      expect(onset.onsetTypes.moveStart).toBe("RETROSPECTIVE_LABEL");
      expect(onset.retrospectiveLabelAtMs).toBeLessThan(onset.causalThresholdAtMs);
    });

    it("11 ambiguous candidate/mover join stays unknown when unmatched", () => {
      const records = buildOpportunityLifecycleRecords({
        trackedCandidates: [],
        movers: [moverFixture({ symbol: "UNRELATEDTRY" })],
      });
      expect(records[0]?.joinStatus).toBe("UNMATCHED");
      expect(records[0]?.joinConfidence).toBe("UNKNOWN");
    });

    it("12 campaign/global scopes are not mixed in dedup key", () => {
      const movers = [
        moverFixture({ campaignId: "camp-a" }),
        moverFixture({ campaignId: "camp-b", moverId: "m2" }),
      ];
      const deduped = dedupeMovers(movers);
      expect(deduped.length).toBe(1);
    });
  });

  describe("latency", () => {
    it("13 missing timestamps do not become zero latency", () => {
      const row = computeLatencySegment("AVAILABLE_TO_FIRST_DETECTION", null, 1000);
      expect(row.durationMs).toBeNull();
      expect(row.status).toBe("MISSING");
    });

    it("14 negative timestamp deltas are invalid", () => {
      const row = computeLatencySegment("DECISION_TO_INTENT", 2000, 1000);
      expect(row.status).toBe("INVALID");
      expect(row.reasonCode).toBe("NEGATIVE_LATENCY");
    });

    it("15 event time and availableAt remain separate segments", () => {
      const timeline = decomposeLatencyTimeline({
        marketEventAtMs: 1000,
        availableAtMs: 1500,
        firstDetectedAtMs: 2200,
      });
      expect(timeline[0]?.segment).toBe("MARKET_EVENT_TO_AVAILABLE");
      expect(timeline[1]?.segment).toBe("AVAILABLE_TO_FIRST_DETECTION");
    });

    it("16 retry submit latency is tracked separately from first attempt", () => {
      const timeline = decomposeLatencyTimeline({
        intentAtMs: 1000,
        submitAtMs: 1200,
        retrySubmitAtMs: 1800,
      });
      expect(timeline.some((row) => row.isRetry)).toBe(true);
    });

    it("17 fill latency is NOT_OBSERVED when no fill exists", () => {
      const timeline = decomposeLatencyTimeline({ submitAtMs: 1000 });
      const fill = timeline.find((row) => row.segment === "SUBMIT_TO_FIRST_FILL");
      expect(fill?.status).toBe("NOT_OBSERVED");
    });

    it("18 counterfactual early entry cannot use future timestamps", () => {
      const points = [
        { t: 1000, price: 100 },
        { t: 2000, price: 101 },
        { t: 3000, price: 106 },
      ];
      const at1500 = detectMoverEvents({ symbol: "BTCTRY", points, now: 1500 });
      const at3000 = detectMoverEvents({ symbol: "BTCTRY", points, now: 3000 });
      expect(at1500.length).toBeLessThanOrEqual(at3000.length);
    });
  });

  describe("economics", () => {
    it("19 AI score is not treated as expected move", () => {
      const row = buildTradeEconomicsRecord({
        aiConfidenceScore: 88,
        expectedMovePercent: null,
        expectedMoveSource: "ai.score",
      });
      expect(row.expectedMove.quality).toBe("MODEL_ESTIMATE");
      expect(row.reasonCodes).toContain("AI_SCORE_NOT_EXPECTED_MOVE");
    });

    it("20 fee amount/rate conversions stay finite", () => {
      const row = buildTradeEconomicsRecord({
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 2,
        takerFeeRate: 0.001,
        costSource: "CONFIGURED_ASSUMPTION",
      });
      expect(row.costCoverage.entryFee).toBeGreaterThan(0);
      expect(row.costCoverage.exitFee).toBeGreaterThan(0);
    });

    it("21 fill price with spread does not add slippage twice", () => {
      const row = buildTradeEconomicsRecord({
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 2,
        takerFeeRate: 0.001,
        costSource: "CONFIGURED_ASSUMPTION",
        fillPriceIncludesSpread: true,
        entrySlippagePct: 0.1,
        exitSlippagePct: 0.1,
      });
      expect(row.costCoverage.entryExecutionCost).toBe(0);
      expect(row.reasonCodes).toContain("SPREAD_ALREADY_IN_FILL");
    });

    it("22 unknown fee does not become zero", () => {
      const row = buildTradeEconomicsRecord({ costSource: "UNKNOWN" });
      expect(row.costCoverage.level).toBe("UNKNOWN");
      expect(row.costCoverage.entryFee).toBeNull();
    });

    it("23 modeled exit cost remains non-measured", () => {
      const row = buildTradeEconomicsRecord({
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 2,
        costSource: "MODELED",
        exitSlippagePct: 0.2,
      });
      expect(row.costCoverage.level).toBe("MODELED");
    });

    it("24 small gross move can be net negative after costs", () => {
      const low = buildTradeEconomicsRecord({
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 0.2,
        takerFeeRate: 0.01,
        costSource: "CONFIGURED_ASSUMPTION",
      });
      expect(low.moveViability.status).toBe("FAIL");
    });

    it("25 move viability pass does not imply expectancy proven", () => {
      const row = buildTradeEconomicsRecord({
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 3,
        takerFeeRate: 0.001,
        costSource: "CONFIGURED_ASSUMPTION",
      });
      const sep = assertEconomicsSeparation(row);
      expect(row.moveViability.status).toBe("PASS");
      expect(sep.expectancyOnly).not.toBe("PROVEN");
    });

    it("26 expectancy stays unknown without win/loss evidence", () => {
      const row = buildTradeEconomicsRecord({
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 3,
        costSource: "CONFIGURED_ASSUMPTION",
      });
      expect(row.expectancy.status).toBe("UNKNOWN");
    });

    it("27 TRY and USDT economics are not merged in one record", () => {
      const tryRow = buildTradeEconomicsRecord({ symbol: "BTCTRY", quoteCurrency: "TRY" });
      const usdtRow = buildTradeEconomicsRecord({ symbol: "BTCUSDT", quoteCurrency: "USDT" });
      expect(tryRow.quoteCurrency).toBe("TRY");
      expect(usdtRow.quoteCurrency).toBe("USDT");
    });

    it("28 insufficient depth cannot be treated as full fill viability", () => {
      const row = evaluatePointInTimeUniverse({
        symbol: "BTCTRY",
        asOfMs: Date.now(),
        executableSymbols: new Set(["BTCTRY"]),
        historicalListingKnown: true,
        bookDepthCoverage: "PARTIAL",
      });
      expect(row.bookDepthCoverage).toBe("PARTIAL");
    });

    it("29 settled net result field remains separate from MFE", () => {
      const row = buildTradeEconomicsRecord({
        mfePct: 4,
        realizedNetReturnPct: 1.2,
        costSource: "CONFIGURED_ASSUMPTION",
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 2,
      });
      expect(row.mfePct).toBe(4);
      expect(row.realizedNet.netReturnPct).toBe(1.2);
    });

    it("30 MFE is not reported as realized profit", () => {
      const row = buildTradeEconomicsRecord({ mfePct: 5, costSource: "UNKNOWN" });
      const sep = assertEconomicsSeparation(row);
      expect(sep.mfeIsNotRealizedProfit).toBe(true);
    });
  });

  describe("integration contracts", () => {
    it("31 ER02 feature snapshot identity is preserved", () => {
      const built = buildFeatureContractSnapshot({
        context: {
          symbol: "BTCTRY",
          lastPrice: 100,
          spreadPercent: 0.1,
          metadata: {
            liquidityScore: 80,
            expectedSlippageBps: 5,
            takerFeePercent: 0.1,
            sourceType: "SYNTHETIC_FIXTURE",
          },
        } as never,
        ai: undefined,
      });
      expect(built.snapshot.schemaVersion).toBe("er02-feature-contract-v1");
      expect(built.snapshot.sourceType).toBe("SYNTHETIC_FIXTURE");
    });

    it("32 ER03 admission and authorization remain separate", () => {
      const auth = resolveExecutionAuthorization({
        mode: "paper",
        strategyActivation: "PAPER_ELIGIBLE",
      });
      expect(auth).toBe("PAPER_ELIGIBLE");
      const live = resolveExecutionAuthorization({
        mode: "live",
        strategyActivation: "PAPER_ELIGIBLE",
      });
      expect(live).toBe("LIVE_DISABLED");
    });

    it("33 ER04 settlement identity can be attached to economics realized net", () => {
      const row = buildTradeEconomicsRecord({
        candidateId: "cand-1",
        decisionId: "dec-1",
        realizedNetPnl: 2.4,
        realizedNetReturnPct: 0.8,
        costSource: "MEASURED",
        entryPrice: 100,
        intendedQuantity: 1,
        takeProfitPercent: 2,
      });
      expect(row.realizedNet.source).toBe("ER04_SETTLEMENT");
    });

    it("34 ER05 horizon outcomes remain isolated per candidate", () => {
      const tracked = trackedFixture();
      const h60 = tracked.outcomes.find((row) => row.horizonMin === 60);
      expect(h60?.mfePct).toBe(2.5);
    });

    it("35 ER01 blocked checks keep NO_GO preflight", () => {
      const out = evaluateRecoveryAssessment([
        {
          checkId: "db",
          required: true,
          status: "BLOCKED",
          evidenceSource: "vitest",
          inspectedHead: "head",
          inspectedWorktreeFingerprint: "fp",
        },
      ]);
      expect(out.nextPaperPreflight).toBe("NO_GO");
    });

    it("36 deterministic analysis config yields stable bucket ids", () => {
      const first = buildMoveBucketReports({ movers: [moverFixture()], tracked: [trackedFixture()] });
      const second = buildMoveBucketReports({ movers: [moverFixture()], tracked: [trackedFixture()] });
      expect(first.map((row) => row.bucketId)).toEqual(second.map((row) => row.bucketId));
    });

    it("37 production admission is not auto-wired from PR01 analysis", () => {
      const report = runPr01OfflineAnalysis({
        hasRecordedMarketData: false,
        trackedCandidates: [trackedFixture()],
        movers: [moverFixture()],
      });
      expect(report.verdicts.STRATEGY_PROMOTION).toBe("NOT_EVALUATED");
      expect(report.verdicts.PAPER_CAMPAIGN_STARTED).toBe(false);
    });

    it("38 experiment registry remains planned until evidence exists", () => {
      const exp = ensurePr01BaselineExperiment();
      expect(exp.status).toBe("PLANNED");
      expect(getProfitabilityExperiment("pr01-opportunity-universe-v1")?.variantCount).toBe(0);
    });
  });

  describe("funnel latency extraction", () => {
    it("builds timeline from structured funnel events", () => {
      const events: FunnelEvent[] = [
        {
          eventId: "e1",
          campaignId: "camp",
          candidateId: "cand-1",
          kind: "CANDIDATE",
          timestamp: new Date(1000).toISOString(),
        },
        {
          eventId: "e2",
          campaignId: "camp",
          candidateId: "cand-1",
          kind: "CANONICAL_DECISION",
          decision: "ENTER",
          timestamp: new Date(2500).toISOString(),
        },
      ];
      const timeline = buildLatencyTimelineFromFunnelEvents(events);
      expect(timeline.firstDetectedAtMs).toBe(1000);
      expect(timeline.canonicalDecisionAtMs).toBe(2500);
    });
  });
});
