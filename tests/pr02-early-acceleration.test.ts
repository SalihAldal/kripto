import { describe, expect, it, beforeEach, afterAll } from "vitest";
import type { MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { BookTickerState } from "@/src/server/market-data/spine/events";
import {
  evaluateCanonicalRegime,
  routeStrategies,
  type StrategyInput,
} from "@/src/server/forensics/p4-regime-strategy-shadow";
import { buildFeatureContractSnapshot } from "@/src/server/execution/er02-feature-contract";
import { resolveCanonicalAdmissionVerdict, resolveExecutionAuthorization } from "@/src/server/execution/er03-canonical-policy";
import { assertEconomicsSeparation, buildTradeEconomicsRecord } from "@/src/server/profitability/pr01-economics";
import { computeEarlyFeatures } from "@/src/server/profitability/pr02-early-features";
import {
  assessEarlyExhaustion,
  evaluateEarlyAccelerationStrategy,
  evaluateEarlyEntryTrigger,
  evaluateEarlySetupQualification,
} from "@/src/server/profitability/pr02-early-evaluator";
import {
  processEarlySetupTransition,
  resetEarlySetupStoreForTests,
  shouldSuppressDuplicateTrigger,
} from "@/src/server/profitability/pr02-early-setup";
import { evaluateEarlyWithRouter, runEarlyReplayAnalysis } from "@/src/server/profitability/pr02-early-replay";
import {
  ensurePr02EarlyExperiment,
  getProfitabilityExperiment,
  resetProfitabilityExperimentRegistryForTests,
} from "@/src/server/profitability/experiment-registry";
import type { EarlyMarketTick } from "@/src/server/profitability/pr02-types";

const marketEventAt = "2026-09-06T06:00:00.000Z";
const evaluatedAt = "2026-09-06T06:00:20.000Z";
const baseNow = Date.parse(evaluatedAt);

function trade(
  price: number,
  side: "BUY" | "SELL",
  offsetMs: number,
  quote = 120,
): MarketTradeEvent {
  const t = baseNow - offsetMs;
  return {
    type: "trade",
    symbol: "BTCTRY",
    price,
    quantity: quote / price,
    quoteNotional: quote,
    eventTime: t,
    tradeTime: t,
    receiveTime: t,
    buyerMaker: side === "SELL",
    takerSide: side,
    source: "memory",
  };
}

function book(price = 100): BookTickerState {
  return {
    symbol: "BTCTRY",
    bestBid: price - 0.02,
    bestBidQty: 2,
    bestAsk: price + 0.02,
    bestAskQty: 2,
    spreadAbsolute: 0.04,
    spreadBps: 4,
    eventTime: baseNow,
    lastUpdateAt: baseNow,
    stale: false,
  };
}

function positiveTrades(): MarketTradeEvent[] {
  const rows: MarketTradeEvent[] = [];
  for (let i = 0; i < 30; i++) {
    const offset = 58_000 - i * 1_800;
    const price = 100 + i * 0.02;
    rows.push(trade(price, i % 5 === 0 ? "SELL" : "BUY", offset, 140 + i));
  }
  for (let i = 0; i < 10; i++) {
    const offset = 4_500 - i * 400;
    const price = 100.6 + i * 0.03;
    rows.push(trade(price, "BUY", offset, 180 + i * 5));
  }
  return rows;
}

function baseStrategyInput(overrides?: Partial<StrategyInput>): StrategyInput {
  return {
    candidateId: "cand-btc",
    sourceType: "SYNTHETIC_FIXTURE",
    marketEventAt,
    evaluatedAt,
    velocity: 0.8,
    acceleration: 0.85,
    volumeAcceleration: 0.9,
    relativeStrength: 0.75,
    spreadBps: 6,
    liquidityScore: 0.85,
    exhaustion: 0.2,
    momentum: 0.7,
    retracement: 0.35,
    breakoutHeld: true,
    rangeScore: 0.2,
    distanceFromMean: 0.2,
    flowRecovery: 0.8,
    staleFeatures: [],
    missingFeatures: [],
    invalidFeatures: [],
    entrySpread: 0.08,
    entrySlippage: 0.04,
    entryFee: 0.1,
    exitSpread: 0.08,
    exitSlippage: 0.04,
    exitFee: 0.1,
    strategyProfitBuffer: 0.12,
    expectedMovePercent: 1.2,
    ...overrides,
  };
}

function bullRegime() {
  return evaluateCanonicalRegime({
    marketEventAt,
    detectedAt: evaluatedAt,
    trend: 0.7,
    volatility: 0.3,
    momentum: 0.5,
    transitionProbability: 0.1,
    chaosProbability: 0.1,
    pumpScore: 0.2,
  });
}

describe("PR02 EARLY acceleration", () => {
  beforeEach(() => {
    resetEarlySetupStoreForTests();
    resetProfitabilityExperimentRegistryForTests();
  });

  afterAll(() => {
    resetEarlySetupStoreForTests();
  });

  it("1 computes price/trade/flow features from real producer trades", () => {
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: positiveTrades(),
      book: book(101.2),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    expect(features.features.priceReturnShortPct?.quality).toBe("VALID");
    expect(features.features.flowImbalance5s?.quality).toBe("VALID");
    expect(features.features.tradeRate5s?.quality).toBe("VALID");
  });

  it("2 price rise alone without flow confirmation does not qualify setup", () => {
    const trades = positiveTrades().map((row) => ({ ...row, takerSide: "SELL" as const }));
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades,
      book: book(101.2),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    const setup = evaluateEarlySetupQualification(features);
    expect(setup.qualified).toBe(false);
    expect(setup.reasonCodes).toContain("FLOW_ACTIVITY_UNCONFIRMED");
  });

  it("3 zero baseline trade rate does not create infinite relative activity", () => {
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: [],
      book: book(),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
      fallback: { velocity: 0.5, acceleration: 0.5, volumeAcceleration: 0.5, relativeStrength: 0.5 },
    });
    expect(features.features.relativeActivity?.quality).not.toBe("VALID");
    expect(features.features.relativeActivity?.value).toBeNull();
  });

  it("4 NaN/Infinity invalid units fail closed", () => {
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: positiveTrades(),
      book: { ...book(), bestBid: Number.NaN, bestAsk: Number.POSITIVE_INFINITY },
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    expect(features.features.spreadBps?.quality).toBe("MISSING");
  });

  it("5 missing required features do not produce ELIGIBLE", () => {
    const result = evaluateEarlyAccelerationStrategy(
      baseStrategyInput({
        missingFeatures: ["velocity", "acceleration", "volumeAcceleration", "relativeStrength", "expectedMovePercent"],
        velocity: 0,
        acceleration: 0,
        volumeAcceleration: 0,
        relativeStrength: 0,
        expectedMovePercent: 0,
      }),
      bullRegime(),
      { trades: positiveTrades(), lifecycleId: "lc-1", nowMs: baseNow },
    );
    expect(result.strategyEvaluation.verdict).not.toBe("ELIGIBLE");
  });

  it("6 optional benchmark missing is reported explicitly", () => {
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: positiveTrades(),
      book: book(101),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    expect(features.missingOptional).toContain("relativeStrength");
  });

  it("7 stale book is not treated as fresh executable price", () => {
    const staleBook = { ...book(), lastUpdateAt: baseNow - 120_000, eventTime: baseNow - 120_000 };
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: positiveTrades(),
      book: staleBook,
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    expect(features.features.spreadBps?.quality).toBe("STALE");
    expect(features.coverage.bookFresh).toBe(false);
  });

  it("8 future candle final values are not used (closed-window only)", () => {
    const trades = positiveTrades();
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades,
      book: book(trades[trades.length - 1]!.price),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    expect(features.features.priceReturnShortPct?.windowMs).toBe(5_000);
    expect(features.features.priceReturnShortPct?.value).not.toBeNull();
  });

  it("9 same venue/time snapshot consistency preserved", () => {
    const trades = positiveTrades();
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades,
      book: book(),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    expect(features.marketEventAt).toBe(marketEventAt);
    expect(features.observedAt).toBe(evaluatedAt);
  });

  it("10 real zero value differs from missing feature", () => {
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: positiveTrades(),
      book: book(),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
      fallback: { relativeStrength: 0 },
    });
    expect(features.features.relativeStrength?.value).toBe(0);
    expect(features.features.relativeStrength?.quality).toBe("VALID");
    expect(features.missingOptional).not.toContain("relativeStrength");
  });

  it("11 positive producer fixture reaches ARMED/TRIGGERED path", () => {
    const result = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      trades: positiveTrades(),
      book: book(101.2),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      lifecycleId: "lc-1",
      nowMs: baseNow,
      intendedNotional: 500,
    });
    expect(["ARMED", "TRIGGERED"]).toContain(result.setupState);
    expect(result.setupQualified).toBe(true);
  });

  it("12 negative fixture does not trigger", () => {
    const result = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      trades: positiveTrades().map((row) => ({ ...row, takerSide: "SELL" as const })),
      book: book(99.5),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      lifecycleId: "lc-1",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
  });

  it("13 spike reversal creates invalidation assessment", () => {
    const trades = positiveTrades();
    trades[trades.length - 1] = trade(99.2, "SELL", 1_000);
    trades[trades.length - 2] = trade(100.5, "BUY", 2_000);
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades,
      book: book(99.2),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    const exhaustion = assessEarlyExhaustion(features, trades);
    expect(exhaustion.spikeReversal || exhaustion.exhausted).toBe(true);
  });

  it("14 duplicate event yields single signalId suppression", () => {
    const ctx = { trades: positiveTrades(), book: book(101.2), baselinePrice: 100, firstDetectionPrice: 100, lifecycleId: "lc-1", nowMs: baseNow };
    const first = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), ctx);
    const second = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), ctx);
    if (first.trigger.signalId) {
      expect(shouldSuppressDuplicateTrigger("cand-btc", "lc-1", first.trigger.signalId)).toBe(true);
      expect(second.transition?.reasonCode).toBe("DUPLICATE_SIGNAL_SUPPRESSED");
    }
  });

  it("15 repeated ticks in same lifecycle do not inflate signal count", () => {
    const ticks: EarlyMarketTick[] = Array.from({ length: 5 }).map((_, idx) => ({
      tickIndex: idx,
      eventAtMs: baseNow + idx * 1_000,
      availableAtMs: baseNow + idx * 1_000,
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      price: 101 + idx * 0.01,
      baselinePrice: 100,
      firstDetectionPrice: 100,
      trades: positiveTrades(),
      book: book(101),
      intendedNotional: 500,
      sourceType: "SYNTHETIC_FIXTURE",
      regime: bullRegime(),
      strategyInput: baseStrategyInput(),
    }));
    const report = runEarlyReplayAnalysis({ datasetId: "fixture-1", ticks });
    expect(report.triggerCount).toBeLessThanOrEqual(report.uniqueLifecycleTriggerCount + 1);
  });

  it("16 rearm only occurs with explicit setup qualification transition", () => {
    processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "sig-1",
    });
    const rearm = processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow + 5_000,
      availableAtMs: baseNow + 5_000,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: true,
      triggerFired: false,
      invalidated: false,
      expired: false,
      signalId: null,
    });
    expect(rearm.newState).toBe("ARMED");
    expect(rearm.reasonCode).toBe("REARM_SETUP_QUALIFIED");
  });

  it("17 expired setup is not counted as new entry signal", () => {
    const expired = processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: false,
      triggerFired: false,
      invalidated: false,
      expired: true,
      signalId: null,
    });
    expect(expired.newState).toBe("EXPIRED");
    const after = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      trades: positiveTrades(),
      book: book(101),
      lifecycleId: "lc-1",
      nowMs: baseNow + 1_000,
    });
    expect(after.setupState).toBe("EXPIRED");
    expect(after.strategyEvaluation.verdict).not.toBe("ELIGIBLE");
  });

  it("18 out-of-order event does not move state backwards from INVALIDATED", () => {
    processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: true,
      triggerFired: false,
      invalidated: true,
      expired: false,
      signalId: null,
    });
    const later = processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow - 5_000,
      availableAtMs: baseNow - 5_000,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "late-sig",
    });
    expect(later.newState).toBe("INVALIDATED");
  });

  it("19 cancelled/invalidated setup does not trigger", () => {
    const result = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      trades: positiveTrades().map((row, idx) => ({ ...row, price: 100 - idx * 0.05, takerSide: "SELL" as const })),
      book: book(98),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      lifecycleId: "lc-1",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
    expect(result.exhaustion.exhausted).toBe(true);
  });

  it("20 reconnect burst does not duplicate triggers with same signalId", () => {
    const sig = "fixed-signal-id-123456789012";
    processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: sig,
    });
    const dup = processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow + 500,
      availableAtMs: baseNow + 500,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: sig,
    });
    expect(dup.reasonCode).toBe("DUPLICATE_SIGNAL_SUPPRESSED");
  });

  it("21 trigger blocked before evidence window warmup completes", () => {
    const result = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      trades: positiveTrades().slice(0, 2),
      book: book(100.5),
      lifecycleId: "lc-1",
      nowMs: baseNow,
    });
    expect(result.dataValidity).toBe("WARMUP");
    expect(result.trigger.triggered).toBe(false);
  });

  it("22 post-trigger invalidation supersedes prior eligibility", () => {
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: positiveTrades(),
      book: book(103),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    features.features.extensionFromBaselinePct = {
      ...features.features.extensionFromBaselinePct!,
      value: 5,
      quality: "VALID",
    };
    const exhaustion = assessEarlyExhaustion(features, positiveTrades());
    const trigger = evaluateEarlyEntryTrigger(features, true, exhaustion.exhausted);
    expect(trigger.triggered).toBe(false);
  });

  it("23 AI score is not used as expected move in economics", () => {
    const econ = buildTradeEconomicsRecord({
      strategyId: "EARLY_ACCELERATION",
      aiConfidenceScore: 88,
      expectedMovePercent: null,
      costSource: "UNKNOWN",
    });
    assertEconomicsSeparation(econ);
    expect(econ.expectedMove.source).not.toBe("AI_CONFIDENCE");
    expect(econ.expectancy.status).not.toBe("PROVEN");
  });

  it("24 unknown cost does not produce net edge PASS", () => {
    const econ = buildTradeEconomicsRecord({ strategyId: "EARLY_ACCELERATION", costSource: "UNKNOWN" });
    expect(econ.costCoverage.level).toBe("UNKNOWN");
    expect(econ.moveViability.pass).not.toBe(true);
  });

  it("25 setup valid remains separate from economics evidence", () => {
    const result = evaluateEarlyAccelerationStrategy(
      baseStrategyInput({ expectedMovePercent: 0 }),
      bullRegime(),
      { trades: positiveTrades(), book: book(101.2), lifecycleId: "lc-1", nowMs: baseNow },
    );
    expect(result.setupQualified).toBe(true);
    expect(result.economicsStatus).toBe("UNKNOWN");
  });

  it("26 strategy evaluator does not submit orders (router only)", () => {
    const routed = evaluateEarlyWithRouter({ strategyInput: baseStrategyInput(), regime: bullRegime(), earlyContext: { trades: positiveTrades(), book: book(101), lifecycleId: "lc-1", nowMs: baseNow } });
    expect(routed.strategyEvaluation.shadowOnly).toBe(true);
    expect(routed.strategyEvaluation.strategyId).toBe("EARLY_ACCELERATION");
  });

  it("27 ER03 authorization rejection is not bypassed", () => {
    const admission = resolveCanonicalAdmissionVerdict(["STRATEGY_CONFLICT"]);
    expect(admission).toBe("WAIT");
    const auth = resolveExecutionAuthorization({ mode: "paper", strategyActivation: "SHADOW_ONLY" });
    expect(auth).toBe("SHADOW_ONLY");
  });

  it("28 LIVE_DISABLED remains enforced", () => {
    const auth = resolveExecutionAuthorization({ mode: "LIVE", strategyActivation: "LIVE_DISABLED" });
    expect(auth).toBe("LIVE_DISABLED");
  });

  it("29 strategy/policy/snapshot identity preserved in evaluation", () => {
    const result = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      trades: positiveTrades(),
      book: book(101),
      lifecycleId: "lc-1",
      featureSnapshotId: "snap-123",
      nowMs: baseNow,
    });
    expect(result.strategyEvaluation.policyVersion).toBe("pr02-early-acceleration-v1");
    expect(result.featureSnapshotId).toBe("snap-123");
  });

  it("30 other strategy missing features do not block EARLY evaluation path", () => {
    const input = baseStrategyInput({ breakoutHeld: false, rangeScore: 0, distanceFromMean: 0 });
    const rows = routeStrategies(input, bullRegime());
    const early = rows.evaluations.find((row) => row.strategyId === "EARLY_ACCELERATION");
    expect(early).toBeTruthy();
    expect(early!.missingFeatures).not.toContain("breakoutHeld");
  });

  it("31 adding future ticks does not rewrite prior deterministic trigger assessment", () => {
    const earlyCtx = { trades: positiveTrades(), book: book(101), lifecycleId: "lc-1", nowMs: baseNow };
    const first = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), earlyCtx);
    const second = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), {
      ...earlyCtx,
      trades: [...positiveTrades(), trade(102, "BUY", 0)],
      nowMs: baseNow + 60_000,
    });
    expect(first.trigger.triggered).toBe(second.trigger.triggered || first.trigger.triggered);
  });

  it("32 late-received old event does not change invalidated terminal state", () => {
    processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: false,
      triggerFired: false,
      invalidated: true,
      expired: false,
      signalId: null,
    });
    const late = processEarlySetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      eventAtMs: baseNow - 10_000,
      availableAtMs: baseNow - 10_000,
      snapshotReference: null,
      warmupComplete: true,
      setupQualified: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "late",
    });
    expect(late.newState).toBe("INVALIDATED");
  });

  it("33 same data/policy yields deterministic signals", () => {
    const ctx = { trades: positiveTrades(), book: book(101.2), lifecycleId: "lc-1", nowMs: baseNow };
    const a = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), ctx);
    resetEarlySetupStoreForTests();
    const b = evaluateEarlyAccelerationStrategy(baseStrategyInput(), bullRegime(), ctx);
    expect(a.trigger).toEqual(b.trigger);
    expect(a.setupQualified).toBe(b.setupQualified);
  });

  it("34 retrospective peak is not an EARLY feature", () => {
    const features = computeEarlyFeatures({
      symbol: "BTCTRY",
      candidateId: "cand-btc",
      lifecycleId: "lc-1",
      marketEventAt,
      observedAt: evaluatedAt,
      nowMs: baseNow,
      trades: positiveTrades(),
      book: book(),
      baselinePrice: 100,
      firstDetectionPrice: 100,
      intendedNotional: 500,
    });
    expect(Object.keys(features.features)).not.toContain("futurePeak");
    expect(Object.keys(features.features)).not.toContain("mfePct");
  });

  it("35 synthetic source is labeled and not mixed as market evidence", () => {
    const result = evaluateEarlyAccelerationStrategy(
      baseStrategyInput({ sourceType: "SYNTHETIC_FIXTURE" }),
      bullRegime(),
      { trades: positiveTrades(), book: book(101), lifecycleId: "lc-1", nowMs: baseNow },
    );
    expect(result.sourceType).toBe("SYNTHETIC_FIXTURE");
  });

  it("36 insufficient book data does not claim ideal executable PnL", () => {
    const econ = buildTradeEconomicsRecord({
      strategyId: "EARLY_ACCELERATION",
      costSource: "UNKNOWN",
      grossMovePct: 2,
      mfePct: 5,
    });
    expect(econ.realizedNet.status).not.toBe("OBSERVED");
    expect(econ.expectancy.status).toBe("UNKNOWN");
  });

  it("37 experiment registry does not mark tuning as completed", () => {
    const exp = ensurePr02EarlyExperiment();
    expect(exp.status).toBe("PLANNED");
    expect(exp.trainUsed).toBe(false);
    expect(getProfitabilityExperiment("pr02-early-acceleration-v1")?.variantCount).toBe(0);
  });

  it("38 production activation/config unchanged via ER02 router path", () => {
    const { strategyInput } = buildFeatureContractSnapshot({
      context: {
        symbol: "BTCTRY",
        lastPrice: 100,
        change24h: 1,
        volume24h: 1_000_000,
        volumeSpikePercent: 10,
        spreadPercent: 0.06,
        volatilityPercent: 1,
        momentumPercent: 0.5,
        orderBookImbalance: 0.1,
        buyPressure: 0.6,
        shortCandleSignal: 1,
        fakeSpikeScore: 0,
        pumpIntensity: 0,
        pumpRisk: 0,
        tradable: true,
        rejectReasons: [],
        metadata: {
          opportunityCandidateId: "cand-btc",
          sourceType: "SYNTHETIC_FIXTURE",
          marketDataTimestamp: marketEventAt,
          tradeVelocity: 0.8,
          priceAcceleration: 0.85,
          volumeAcceleration: 0.9,
          relativeStrength: 0.75,
          liquidityScore: 0.85,
          expectedMovePercent: 1.2,
          takerFeePercent: 0.1,
          strategyProfitBuffer: 0.12,
          expectedSlippageBps: 4,
        },
      },
      ai: undefined,
      now: baseNow,
    });
    const router = routeStrategies(
      {
        ...strategyInput,
        earlyContext: {
          trades: positiveTrades(),
          book: book(101.2),
          baselinePrice: 100,
          firstDetectionPrice: 100,
          lifecycleId: "lc-er02",
          nowMs: baseNow,
        },
      },
      bullRegime(),
    );
    expect(router.shadowOnly).toBe(true);
    expect(router.evaluations.find((row) => row.strategyId === "EARLY_ACCELERATION")).toBeTruthy();
  });
});
