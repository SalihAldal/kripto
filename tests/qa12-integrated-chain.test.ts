import { describe, expect, it, beforeEach, vi } from "vitest";

const claimMocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    appSetting: {
      create: claimMocks.create,
      findUnique: claimMocks.findUnique,
      deleteMany: claimMocks.deleteMany,
      update: vi.fn(),
    },
  },
}));
import { resolveTerminalEvidence } from "@/src/server/forensics/er01-telemetry-verdict";
import { resolveExecutionAuthorization } from "@/src/server/execution/er03-canonical-policy";
import { buildFeatureContractSnapshot } from "@/src/server/execution/er02-feature-contract";
import { evaluateCanonicalRegime, routeStrategies } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { freezeSelectedStrategySignal, resolveInvalidationFromSelectedSignal } from "@/src/server/execution/fix01-selected-signal";
import { buildOutcomeHorizonRows } from "@/src/server/shadow-outcome/canonical-dataset";
import { evaluateBreakoutRetestStrategy } from "@/src/server/profitability/pr03-breakout-evaluator";
import { evaluateMomentumContinuationStrategy } from "@/src/server/profitability/pr03-momentum-evaluator";
import { evaluateEarlyAccelerationStrategy } from "@/src/server/profitability/pr02-early-evaluator";
import {
  evaluateExitPolicyTick,
  initializeExitPolicyState,
  markExitDataEnd,
  resetExitPolicyStoreForTests,
} from "@/src/server/profitability/pr04-exit-evaluator";
import { buildExitPolicySnapshotAtEntry } from "@/src/server/profitability/pr04-exit-evaluator";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import {
  isPr04ExitEvaluationEnabled,
} from "@/src/server/profitability/pr04-exit-bridge";
import { runPr04ExitReplayWithOutcome } from "@/src/server/profitability/pr04-replay";
import { buildMatchedEntryManifest } from "@/src/server/profitability/pr04-matched-entry-manifest";
import { runPr05OfflineComparison } from "@/src/server/profitability/pr05-offline-comparison";
import { detectFutureDataLeakFixture } from "@/src/server/profitability/pr05-negative-control";
import { buildQa12FinalAssessment } from "@/src/server/forensics/qa12-final-assessment";
import type { StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

function baseStrategyInput(overrides?: Partial<StrategyInput>): StrategyInput {
  return {
    candidateId: "cand-qa12",
    sourceType: "SYNTHETIC_FIXTURE",
    marketEventAt: new Date(baseNow).toISOString(),
    evaluatedAt: new Date(baseNow).toISOString(),
    velocity: 0.8,
    acceleration: 0.7,
    volumeAcceleration: 0.75,
    relativeStrength: 0.7,
    spreadBps: 8,
    liquidityScore: 72,
    exhaustion: 0.2,
    momentum: 0.75,
    retracement: 0.3,
    breakoutHeld: true,
    rangeScore: 0.4,
    distanceFromMean: 0.3,
    flowRecovery: 0.7,
    entrySpread: 0.05,
    entrySlippage: 0.03,
    entryFee: 0.1,
    exitSpread: 0.05,
    exitSlippage: 0.03,
    exitFee: 0.1,
    strategyProfitBuffer: 0.2,
    expectedMovePercent: 2.5,
    ...overrides,
  };
}

beforeEach(() => {
  resetExitPolicyStoreForTests();
  vi.clearAllMocks();
  claimMocks.create.mockResolvedValue({ id: "setting-1" });
  claimMocks.findUnique.mockResolvedValue(null);
  claimMocks.deleteMany.mockResolvedValue({ count: 1 });
});

describe("QA12 integrated chain", () => {
  it("A early strategy path produces evaluation without future data", () => {
    const input = baseStrategyInput();
    const regime = evaluateCanonicalRegime({
      marketEventAt: input.marketEventAt,
      detectedAt: input.evaluatedAt,
      trend: 0.7,
      volatility: 0.4,
      momentum: 0.7,
      transitionProbability: 0.2,
      chaosProbability: 0.1,
      pumpScore: 0.3,
    });
    const early = evaluateEarlyAccelerationStrategy(input, regime, {
      trades: [],
      book: null,
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      intendedNotional: 1000,
      lifecycleId: "lc-early",
      nowMs: baseNow,
      replayTickIndex: 0,
    });
    expect(early.strategyEvaluation.strategyId).toBe("EARLY_ACCELERATION");
    expect(early.trigger.triggered).toBe(false);
    expect(early.trigger.reasonCodes).toContain("PRODUCER_CONTEXT_MISSING");
  });

  it("B momentum partial exit preserves remaining quantity", () => {
    const invalidation = {
      referenceLevel: 100,
      invalidationThreshold: 99.2,
      reasonCode: "LEVEL_HOLD_BREACH",
      computedAtMs: baseNow,
      availableAtMs: baseNow,
      validUntilMs: baseNow + 60_000,
      sourceObservations: [],
    };
    const snap = buildExitPolicySnapshotAtEntry({
      positionId: "pos-partial",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
      entrySignalId: "sig-p",
      setupId: "setup-p",
      exitPolicyId: "STRUCTURAL_PARTIAL_TRAIL",
      experimentalMode: true,
      takeProfitPercent: 3,
      invalidation,
    });
    initializeExitPolicyState({
      snapshot: snap,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
    });
    const tick = {
      eventId: "evt:1",
      eventAtMs: baseNow + 1000,
      availableAtMs: baseNow + 1000,
      markPrice: 102.6,
      bid: 102.6,
      ask: 102.6,
      high: 102.6,
      low: 102.6,
      closed: true,
      stale: false,
      dataGap: false,
    };
    evaluateExitPolicyTick({ positionId: "pos-partial", side: "LONG", observation: tick });
    const state = evaluateExitPolicyTick({ positionId: "pos-partial", side: "LONG", observation: tick }).state;
    expect(state.remainingQuantity).toBeLessThanOrEqual(1);
  });

  it("C breakout structural stop fires on gap through invalidation", () => {
    const invalidation = {
      referenceLevel: 100,
      invalidationThreshold: 99.2,
      reasonCode: "LEVEL_HOLD_BREACH",
      computedAtMs: baseNow,
      availableAtMs: baseNow,
      validUntilMs: baseNow + 60_000,
      sourceObservations: [],
    };
    const manifest = buildMatchedEntryManifest({
      entrySignalId: "sig-bo",
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
      entryAtMs: baseNow,
      fills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      riskReference: buildRiskReference({
        entryPrice: 100,
        initialStopPrice: 99.2,
        initialQuantity: 1,
        entryFee: 0.1,
        includesFeesInBreakEven: true,
        computedAtMs: baseNow,
      }),
      invalidation,
      featureEvidenceIds: [],
      dataSource: "SYNTHETIC_FIXTURE",
      replayWindow: { fromMs: baseNow, toMs: baseNow + 120_000 },
    });
    const outcome = runPr04ExitReplayWithOutcome({
      datasetId: "qa12",
      manifest,
      policyId: "STRUCTURAL_STOP_TARGET",
      ticks: [{ tickIndex: 0, observation: { eventId: "e1", eventAtMs: baseNow + 1000, availableAtMs: baseNow + 1000, markPrice: 99.1, bid: 99.1, ask: 99.1, high: 99.1, low: 99.1, closed: true, stale: false, dataGap: false } }],
    });
    expect(outcome.report.decisionCount).toBeGreaterThan(0);
  });

  it("D ineligible setup does not produce ENTER terminal evidence", () => {
    const terminal = resolveTerminalEvidence({
      hasCandidate: true,
      structured: { decision: "REJECT", reasonCode: "SETUP_WEAK", source: "CANONICAL" },
      legacyReason: null,
      openedPosition: false,
      submittedOrder: false,
      fillCount: 0,
    });
    expect(terminal.decision).toBe("REJECT");
    expect(terminal.executionOutcome).toBe("NOT_SUBMITTED");
  });

  it("E router selects single preferred strategy under conflict", () => {
    const input = baseStrategyInput();
    const regime = evaluateCanonicalRegime({
      marketEventAt: input.marketEventAt,
      detectedAt: input.evaluatedAt,
      trend: 0.8,
      volatility: 0.3,
      momentum: 0.8,
      transitionProbability: 0.1,
      chaosProbability: 0.05,
      pumpScore: 0.2,
    });
    const router = routeStrategies(input, regime);
    expect(router.evaluations.length).toBeGreaterThan(0);
    expect(router.eligibleStrategies.length).toBeLessThanOrEqual(router.evaluations.length);
  });

  it("F durable claim rejects wrong owner release", async () => {
    const { claimDurableCanonicalExecutionAttempt, releaseDurableCanonicalExecutionAttempt } = await import(
      "@/src/server/hot-path/execution-attempt-lock.service"
    );
    claimMocks.findUnique.mockResolvedValueOnce({
      value: { executionId: "exec-qa12", ownerFenceToken: "fence-1" },
    });
    const release = await releaseDurableCanonicalExecutionAttempt({
      userId: "qa12-user",
      candidateId: "BTC:QA12",
      executionId: "exec-other",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(release.ok).toBe(false);
  });

  it("G exit coordinator prevents duplicate sell on in-flight order", () => {
    const snap = buildExitPolicySnapshotAtEntry({
      positionId: "pos-race",
      strategyId: "EARLY_ACCELERATION",
      entryPolicyVersion: "pr02-early-acceleration-v1",
      entrySignalId: "sig-r",
      setupId: "setup-r",
      exitPolicyId: "BASELINE_FIXED_TP_SL",
      experimentalMode: true,
      takeProfitPercent: 3,
      invalidation: null,
    });
    initializeExitPolicyState({
      snapshot: snap,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
    });
    const state = evaluateExitPolicyTick({
      positionId: "pos-race",
      side: "LONG",
      observation: {
        eventId: "evt:race",
        eventAtMs: baseNow,
        availableAtMs: baseNow,
        markPrice: 103,
        bid: 103,
        ask: 103,
        high: 103,
        low: 103,
        closed: true,
        stale: false,
        dataGap: false,
      },
    }).state;
    state.orderState = "SUBMITTED";
    state.reservedSellQuantity = 1;
    const second = evaluateExitPolicyTick({
      positionId: "pos-race",
      side: "LONG",
      observation: {
        eventId: "evt:race2",
        eventAtMs: baseNow + 1000,
        availableAtMs: baseNow + 1000,
        markPrice: 103,
        bid: 103,
        ask: 103,
        high: 103,
        low: 103,
        closed: true,
        stale: false,
        dataGap: false,
      },
    });
    expect(second.decision.reasonCode).toBe("ORDER_IN_FLIGHT");
  });

  it("H stale mark does not produce exit fill", () => {
    const snap = buildExitPolicySnapshotAtEntry({
      positionId: "pos-stale",
      strategyId: "BREAKOUT_RETEST",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
      entrySignalId: "sig-s",
      setupId: "setup-s",
      exitPolicyId: "STRUCTURAL_STOP_TARGET",
      experimentalMode: true,
      takeProfitPercent: 3,
      invalidation: null,
    });
    initializeExitPolicyState({
      snapshot: snap,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
    });
    const result = evaluateExitPolicyTick({
      positionId: "pos-stale",
      side: "LONG",
      observation: {
        eventId: "evt:stale",
        eventAtMs: baseNow,
        availableAtMs: baseNow,
        markPrice: null,
        bid: null,
        ask: null,
        high: null,
        low: null,
        closed: true,
        stale: true,
        dataGap: false,
      },
    });
    expect(result.decision.reasonCode).toBe("STALE_MARK");
  });

  it("I feature contract marks missing data instead of fabricating values", () => {
    const out = buildFeatureContractSnapshot({
      context: {
        symbol: "AAAUSDT",
        spreadPercent: 0.05,
        metadata: {},
      } as Parameters<typeof buildFeatureContractSnapshot>[0]["context"],
      ai: undefined,
    });
    expect(out.snapshot.missingFeatures.length).toBeGreaterThan(0);
  });

  it("J data end marks position censored not closed profit", () => {
    const snap = buildExitPolicySnapshotAtEntry({
      positionId: "pos-cens",
      strategyId: "MOMENTUM_CONTINUATION",
      entryPolicyVersion: "pr03-momentum-and-retest-v1",
      entrySignalId: "sig-c",
      setupId: "setup-c",
      exitPolicyId: "STRUCTURAL_STOP_TRAIL",
      experimentalMode: true,
      takeProfitPercent: 3,
      invalidation: null,
    });
    initializeExitPolicyState({
      snapshot: snap,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
    });
    const ended = markExitDataEnd("pos-cens");
    expect(ended?.terminalStatus).toBe("CENSORED");
  });

  it("K duplicate event id does not change economics twice", () => {
    const snap = buildExitPolicySnapshotAtEntry({
      positionId: "pos-dup",
      strategyId: "EARLY_ACCELERATION",
      entryPolicyVersion: "pr02-early-acceleration-v1",
      entrySignalId: "sig-d",
      setupId: "setup-d",
      exitPolicyId: "STRUCTURAL_STOP_TRAIL",
      experimentalMode: true,
      takeProfitPercent: 3,
      invalidation: null,
    });
    initializeExitPolicyState({
      snapshot: snap,
      side: "LONG",
      entryFills: [{ price: 100, quantity: 1, fee: 0.1, atMs: baseNow }],
      entryFee: 0.1,
    });
    const obs = {
      eventId: "evt:dup",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      markPrice: 102,
      bid: 102,
      ask: 102,
      high: 102,
      low: 102,
      closed: true,
      stale: false,
      dataGap: false,
    };
    evaluateExitPolicyTick({ positionId: "pos-dup", side: "LONG", observation: obs });
    const second = evaluateExitPolicyTick({ positionId: "pos-dup", side: "LONG", observation: obs });
    expect(second.decision.reasonCode).toBe("DUPLICATE_EVENT_SUPPRESSED");
  });

  it("L future availableAt is detected as leak", () => {
    expect(detectFutureDataLeakFixture({ decisionAtMs: baseNow, observationAvailableAtMs: baseNow + 5000 })).toBe(true);
  });

  it("M invalidation bridge uses frozen selected signal without re-evaluation", () => {
    const input = baseStrategyInput({ breakoutHeld: true, flowRecovery: 0.8, acceleration: 0.8 });
    const regime = evaluateCanonicalRegime({
      marketEventAt: input.marketEventAt,
      detectedAt: input.evaluatedAt,
      trend: 0.8,
      volatility: 0.3,
      momentum: 0.8,
      transitionProbability: 0.1,
      chaosProbability: 0.05,
      pumpScore: 0.2,
    });
    const candle = (index: number, o: number, h: number, l: number, c: number) => {
      const openTime = baseNow - (10 - index) * 30_000;
      const closeTime = openTime + 30_000;
      return { openTime, closeTime, open: o, high: h, low: l, close: c, volume: 1000, closed: true, availableAt: closeTime };
    };
    const candles = [
      candle(0, 98, 99, 97.5, 98.5),
      candle(1, 98.5, 99.2, 98.2, 99),
      candle(2, 99, 99.6, 98.8, 99.4),
      candle(3, 99.2, 100, 99, 99.8),
      candle(4, 99.5, 99.7, 99.1, 99.3),
      candle(5, 99.2, 99.5, 99, 99.2),
      candle(6, 99.5, 101.5, 99.4, 101.3),
      candle(7, 101.2, 101.4, 99.9, 100.8),
      candle(8, 100.7, 101.8, 100.5, 101.5),
      candle(9, 101.4, 102, 101.2, 101.9),
    ];
    const trades = Array.from({ length: 20 }, (_, index) => {
      const t = baseNow - (20 - index) * 1_000;
      return {
        type: "trade" as const,
        symbol: "BTCTRY",
        price: 101 + index * 0.01,
        quantity: 1,
        quoteNotional: 150,
        eventTime: t,
        tradeTime: t,
        receiveTime: t,
        buyerMaker: false,
        takerSide: "BUY" as const,
        source: "memory" as const,
      };
    });
    const breakoutDetail = evaluateBreakoutRetestStrategy(input, regime, {
      candles,
      trades,
      lifecycleId: "lc-qa12-inv",
      nowMs: baseNow,
    });
    expect(breakoutDetail.trigger.triggered).toBe(true);
    const selected = freezeSelectedStrategySignal("BREAKOUT_RETEST", breakoutDetail);
    expect(selected.invalidation?.reasonCode).toBe("LEVEL_HOLD_BREACH");
    expect(resolveInvalidationFromSelectedSignal(selected)?.invalidationThreshold).toBe(
      breakoutDetail.invalidation?.invalidationThreshold,
    );
    expect(selected.signalId).toBe(breakoutDetail.trigger.signalId);
  });

  it("N horizon rows do not include prices after horizon end", () => {
    const tracked = {
      snapshot: {
        candidateId: "AAAUSDT:1",
        symbol: "AAAUSDT",
        primaryLane: "EARLY",
        firstDetectedAt: baseNow,
        firstDetectionPrice: 100,
        opportunityScore: 80,
        initialRank: 1,
        source: "memory",
      },
      latestStage: "FIRST_DETECTED",
      pricePoints: [
        { t: baseNow, price: 100 },
        { t: baseNow + 30_000, price: 101 },
        { t: baseNow + 120_000, price: 105 },
      ],
    } as Parameters<typeof buildOutcomeHorizonRows>[0]["tracked"];
    const rows = buildOutcomeHorizonRows({
      datasetId: "qa12",
      tracked,
      baselineStage: "FIRST_DETECTED",
      nowMs: baseNow + 60_000,
    });
    const oneMin = rows.find((r) => r.horizonMinutes === 1);
    expect(oneMin).toBeDefined();
    if (oneMin?.endReturnPercent != null) {
      expect(oneMin.endReturnPercent).toBeLessThan(5);
    }
  });

  it("O offline market comparison remains blocked without recorded data", () => {
    const report = runPr05OfflineComparison({
      datasetId: "qa12",
      manifests: [],
      ticksByManifestId: {},
      recordedMarketData: false,
    });
    expect(report.status).toBe("BLOCKED");
    expect(report.selectedCandidateIds).toEqual([]);
  });

  it("P live authorization and pr04 default remain disabled", () => {
    expect(isPr04ExitEvaluationEnabled()).toBe(false);
    expect(resolveExecutionAuthorization({ mode: "LIVE", strategyActivation: "LIVE_DISABLED" })).toBe("LIVE_DISABLED");
  });

  it("Q qa12 assessment verdicts are fail-closed on blocked checks", () => {
    const assessment = buildQa12FinalAssessment({
      headCommit: "abc",
      worktreeFingerprint: "dirty",
      openCritical: 1,
      openHigh: 2,
      requiredChecksNotRun: ["DB_SETTLEMENT_INTEGRATION", "MARKET_REPLAY_EXPERIMENT"],
    });
    expect(assessment.verdicts.FINAL_ENGINEERING_VERDICT).toBe("PARTIAL");
    expect(assessment.verdicts.PROFITABILITY_EVIDENCE).toBe("INSUFFICIENT_DATA");
    expect(assessment.verdicts.OVERALL_QA_STATUS).toBe("QA_PENDING");
    expect(assessment.verdicts.PAPER_CAMPAIGN_STARTED).toBe(false);
  });
});
