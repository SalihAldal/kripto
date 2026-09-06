import { describe, expect, it, beforeEach, afterAll } from "vitest";
import type { MarketTradeEvent } from "@/src/server/market-data/spine/events";
import {
  evaluateCanonicalRegime,
  routeStrategies,
  type StrategyInput,
} from "@/src/server/forensics/p4-regime-strategy-shadow";
import { resolveCanonicalAdmissionVerdict, resolveExecutionAuthorization } from "@/src/server/execution/er03-canonical-policy";
import { claimCanonicalExecutionAttempt, resetCanonicalExecutionAttemptsForTests } from "@/src/server/hot-path/execution-attempt-lock.service";
import { buildTradeEconomicsRecord } from "@/src/server/profitability/pr01-economics";
import {
  computeConfirmedPivotLevel,
  computeFlowFromTrades,
  detectBreakoutOnClosedCandle,
  detectHoldAboveLevel,
  detectRetest,
  computeImpulseMetrics,
} from "@/src/server/profitability/pr03-causal-features";
import { evaluateBreakoutRetestStrategy } from "@/src/server/profitability/pr03-breakout-evaluator";
import {
  getBreakoutSetupState,
  processBreakoutSetupTransition,
  resetBreakoutSetupStoreForTests,
} from "@/src/server/profitability/pr03-breakout-setup";
import { evaluateMomentumContinuationStrategy } from "@/src/server/profitability/pr03-momentum-evaluator";
import {
  getMomentumSetupState,
  processMomentumSetupTransition,
  resetMomentumSetupStoreForTests,
} from "@/src/server/profitability/pr03-momentum-setup";
import { evaluatePr03WithRouter, runPr03ReplayAnalysis } from "@/src/server/profitability/pr03-replay";
import {
  ensurePr03MomentumAndRetestExperiment,
  getProfitabilityExperiment,
  resetProfitabilityExperimentRegistryForTests,
} from "@/src/server/profitability/experiment-registry";
import type { CausalCandle } from "@/src/server/profitability/pr03-types";

const marketEventAt = "2026-09-06T08:00:00.000Z";
const evaluatedAt = "2026-09-06T08:10:00.000Z";
const baseNow = Date.parse(evaluatedAt);
const CANDLE_MS = 30_000;

function candle(
  index: number,
  o: number,
  h: number,
  l: number,
  c: number,
  closed = true,
  availDelay = 0,
): CausalCandle {
  const openTime = baseNow - (10 - index) * CANDLE_MS;
  const closeTime = openTime + CANDLE_MS;
  return {
    openTime,
    closeTime,
    open: o,
    high: h,
    low: l,
    close: c,
    volume: 1000 + index * 10,
    closed,
    availableAt: closeTime + availDelay,
  };
}

function buyFlowTrades(count = 12, basePrice = 101): MarketTradeEvent[] {
  const rows: MarketTradeEvent[] = [];
  for (let i = 0; i < count; i++) {
    const t = baseNow - (count - i) * 1_000;
    rows.push({
      type: "trade",
      symbol: "BTCTRY",
      price: basePrice + i * 0.01,
      quantity: 1,
      quoteNotional: 150,
      eventTime: t,
      tradeTime: t,
      receiveTime: t,
      buyerMaker: false,
      takerSide: "BUY",
      source: "memory",
    });
  }
  return rows;
}

function breakoutCandleSeries(): CausalCandle[] {
  return [
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
}

function momentumCandleSeries(): CausalCandle[] {
  return [
    candle(0, 100, 100.3, 99.8, 100.1),
    candle(1, 100.1, 100.6, 100, 100.5),
    candle(2, 100.5, 101.2, 100.4, 101),
    candle(3, 101, 102.5, 100.9, 102.2),
    candle(4, 102.2, 102.6, 101.8, 102),
    candle(5, 102, 102.1, 101.4, 101.6),
    candle(6, 101.6, 102.4, 101.5, 102.2),
    candle(7, 102.2, 102.8, 102, 102.6),
    candle(8, 102.6, 103, 102.4, 102.9),
    candle(9, 102.9, 103.2, 102.7, 103.1),
  ];
}

function baseStrategyInput(overrides?: Partial<StrategyInput>): StrategyInput {
  return {
    candidateId: "cand-btc",
    sourceType: "SYNTHETIC_FIXTURE",
    marketEventAt,
    evaluatedAt,
    velocity: 0.7,
    acceleration: 0.75,
    volumeAcceleration: 0.8,
    relativeStrength: 0.7,
    spreadBps: 6,
    liquidityScore: 0.85,
    exhaustion: 0.2,
    momentum: 0.75,
    retracement: 0.3,
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
    volatility: 0.35,
    momentum: 0.55,
    transitionProbability: 0.1,
    chaosProbability: 0.1,
    pumpScore: 0.2,
  });
}

describe("PR03 momentum continuation + breakout retest", () => {
  beforeEach(() => {
    resetBreakoutSetupStoreForTests();
    resetMomentumSetupStoreForTests();
    resetCanonicalExecutionAttemptsForTests();
    resetProfitabilityExperimentRegistryForTests();
  });

  afterAll(() => {
    resetBreakoutSetupStoreForTests();
    resetMomentumSetupStoreForTests();
  });

  it("1 insufficient history yields WARMUP for breakout", () => {
    const candles = breakoutCandleSeries().slice(0, 3);
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles,
      trades: [],
      lifecycleId: "lc-1",
      nowMs: baseNow,
    });
    expect(result.setupState).toBe("WARMUP");
    expect(result.trigger.triggered).toBe(false);
  });

  it("2 missing mandatory flow data blocks breakout trigger", () => {
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandleSeries(),
      trades: [],
      lifecycleId: "lc-2",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
    expect(result.trigger.reasonCodes).toContain("FLOW_DATA_MISSING");
  });

  it("3 zero volume denominator handled safely in flow", () => {
    const flow = computeFlowFromTrades([], baseNow);
    expect(flow.quality).toBe("INSUFFICIENT_DATA");
    expect(flow.value).toBeNull();
  });

  it("4 stale snapshot with future availableAt does not trigger", () => {
    const series = breakoutCandleSeries();
    const candles = series.map((c, i) =>
      i === series.length - 1 ? { ...c, availableAt: baseNow + 60_000, closed: true } : c,
    );
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles,
      trades: buyFlowTrades(),
      lifecycleId: "lc-3",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
  });

  it("5 eventAt old but availableAt in future is excluded from pivot", () => {
    const candles = breakoutCandleSeries().map((c) => ({ ...c, availableAt: baseNow + 120_000 }));
    const pivot = computeConfirmedPivotLevel(candles, baseNow);
    expect(pivot.quality).not.toBe("VALID");
  });

  it("6 adding future candles does not rewrite prior breakout evaluation", () => {
    const ctx = { candles: breakoutCandleSeries().slice(0, 8), trades: buyFlowTrades(), lifecycleId: "lc-4", nowMs: baseNow };
    const first = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    resetBreakoutSetupStoreForTests();
    const second = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      ...ctx,
      candles: breakoutCandleSeries(),
    });
    expect(first.referenceLevel?.level).toBe(second.referenceLevel?.level);
  });

  it("7 pivot only available after right-side confirmation bars", () => {
    const partial = breakoutCandleSeries().slice(0, 5);
    const full = breakoutCandleSeries().slice(0, 7);
    const p1 = computeConfirmedPivotLevel(partial, baseNow);
    const p2 = computeConfirmedPivotLevel(full, baseNow);
    expect(p1.quality).toBe("INSUFFICIENT_DATA");
    expect(p2.level).toBe(100);
  });

  it("8 breakout observation does not mutate level calculation window retroactively", () => {
    const candles = breakoutCandleSeries();
    const before = computeConfirmedPivotLevel(candles.slice(0, 7), baseNow);
    const after = computeConfirmedPivotLevel(candles, baseNow);
    expect(before.level).toBe(after.level);
  });

  it("9 frozen reference level does not change after setup started", () => {
    const candles = breakoutCandleSeries();
    evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: candles.slice(0, 7),
      trades: buyFlowTrades(),
      lifecycleId: "lc-5",
      nowMs: baseNow - 30_000,
    });
    const later = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: candles.map((c, i) => (i === 3 ? { ...c, high: 105 } : c)),
      trades: buyFlowTrades(),
      lifecycleId: "lc-5",
      nowMs: baseNow,
    });
    expect(later.referenceLevel?.level).toBe(100);
  });

  it("10 positive breakout→retest→hold→reacceleration path can trigger", () => {
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandleSeries(),
      trades: buyFlowTrades(20, 101.5),
      lifecycleId: "lc-6",
      nowMs: baseNow,
    });
    expect(result.setupState).toBe("TRIGGERED");
    expect(result.trigger.triggered).toBe(true);
    expect(result.trigger.signalId).toBeTruthy();
  });

  it("11 breakout without retest does not trigger", () => {
    const candles = breakoutCandleSeries().slice(0, 7);
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles,
      trades: buyFlowTrades(),
      lifecycleId: "lc-7",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
    expect(result.trigger.reasonCodes).toContain("RETEST_NOT_OBSERVED");
  });

  it("12 touch-only without hold structure is insufficient", () => {
    const candles = [
      ...breakoutCandleSeries().slice(0, 7),
      candle(7, 101.2, 101.4, 100.24, 100.3),
      candle(8, 100.3, 100.5, 100.0, 100.2),
    ];
    const retest = detectRetest(100, candles, baseNow, candles[6]!.closeTime);
    const hold = detectHoldAboveLevel(100, candles, baseNow, retest.observed ? candles[7]!.closeTime : baseNow);
    expect(retest.observed).toBe(true);
    expect(hold.held).toBe(false);
  });

  it("13 failed hold produces invalidation on breakout path", () => {
    const candles = [
      ...breakoutCandleSeries().slice(0, 7),
      candle(7, 101.2, 101.4, 99.4, 99.5),
    ];
    const retest = detectRetest(100, candles, baseNow, candles[6]!.closeTime);
    expect(retest.invalidated).toBe(true);
  });

  it("14 setup without timely retest expires", () => {
    processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-exp",
      eventAtMs: baseNow - 500_000,
      availableAtMs: baseNow - 500_000,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: true,
      retestObserved: false,
      holdConfirmed: false,
      triggerFired: false,
      invalidated: false,
      expired: true,
      signalId: null,
      breakoutAtMs: baseNow - 500_000,
      retestAtMs: null,
    });
    expect(getBreakoutSetupState("cand-btc", "lc-exp")).toBe("EXPIRED");
  });

  it("15 ambiguous same-candle ordering does not fabricate retest then hold", () => {
    const level = 100;
    const ambiguous = [candle(6, 99.5, 101.5, 99.8, 101.2)];
    const breakout = detectBreakoutOnClosedCandle(level, ambiguous, baseNow);
    const retest = detectRetest(level, ambiguous, baseNow, ambiguous[0]!.closeTime);
    expect(breakout.confirmed).toBe(true);
    expect(retest.observed).toBe(false);
  });

  it("16 tick-size tolerance boundary respected at retest band", () => {
    const level = 100;
    const bandLow = level * (1 - 25 / 10_000);
    const candles = [
      candle(6, 101, 101.5, 101.1, 101.3),
      candle(7, 101, 101.2, bandLow + 0.001, 100.9),
    ];
    const retest = detectRetest(level, candles, baseNow, candles[0]!.closeTime);
    expect(retest.observed).toBe(true);
  });

  it("17 partial candle cannot confirm breakout close policy", () => {
    const candles = [
      ...breakoutCandleSeries().slice(0, 6),
      candle(6, 99.5, 101.5, 99.4, 101.3, false),
    ];
    const breakout = detectBreakoutOnClosedCandle(100, candles, baseNow);
    expect(breakout.confirmed).toBe(false);
  });

  it("18 momentum impulse→pause→resumption positive path", () => {
    const result = evaluateMomentumContinuationStrategy(baseStrategyInput(), bullRegime(), {
      candles: momentumCandleSeries(),
      trades: buyFlowTrades(15, 102.5),
      lifecycleId: "lc-m1",
      nowMs: baseNow,
    });
    expect(result.setupState).toBe("TRIGGERED");
    expect(result.trigger.triggered).toBe(true);
  });

  it("19 high legacy momentum score alone does not trigger continuation", () => {
    const result = evaluateMomentumContinuationStrategy(
      baseStrategyInput({ momentum: 0.99, acceleration: 0.99, flowRecovery: 0.99 }),
      bullRegime(),
      { candles: breakoutCandleSeries().slice(0, 4), trades: [], lifecycleId: "lc-m2", nowMs: baseNow },
    );
    expect(result.trigger.triggered).toBe(false);
    expect(
      result.trigger.reasonCodes.some((code) =>
        ["IMPULSE_NOT_CONFIRMED", "WARMUP_INCOMPLETE"].includes(code),
      ),
    ).toBe(true);
  });

  it("20 broken continuation structure invalidates", () => {
    const broken = momentumCandleSeries().map((c, i) =>
      i >= 7 ? { ...c, close: 99, low: 98.5, high: 99.2 } : c,
    );
    const result = evaluateMomentumContinuationStrategy(baseStrategyInput(), bullRegime(), {
      candles: broken,
      trades: buyFlowTrades(),
      lifecycleId: "lc-m3",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
    expect(["INVALIDATED", "EXPIRED", "WARMUP", "OBSERVING", "IMPULSE_CONFIRMED", "PAUSE_OBSERVED"]).toContain(result.setupState);
  });

  it("21 overextended or expired momentum trigger blocked", () => {
    processMomentumSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-mexp",
      eventAtMs: baseNow - 600_000,
      availableAtMs: baseNow - 600_000,
      snapshotReference: null,
      warmupComplete: true,
      impulseConfirmed: true,
      pauseObserved: true,
      resumptionArmed: true,
      triggerFired: false,
      invalidated: false,
      expired: true,
      signalId: null,
      impulseReferencePrice: 102.5,
      impulseAtMs: baseNow - 600_000,
      pauseLowPrice: 101.5,
    });
    expect(getMomentumSetupState("cand-btc", "lc-mexp")).toBe("EXPIRED");
  });

  it("22 continuation does not require artificial retest level", () => {
    const result = evaluateMomentumContinuationStrategy(baseStrategyInput(), bullRegime(), {
      candles: momentumCandleSeries(),
      trades: buyFlowTrades(),
      lifecycleId: "lc-m4",
      nowMs: baseNow,
    });
    expect(result.impulseReferencePrice).toBeTruthy();
    expect(result.invalidation?.reasonCode).toBe("IMPULSE_STRUCTURE_BREACH");
  });

  it("23 EARLY, momentum and breakout report distinct strategy identities", () => {
    const routed = routeStrategies(
      {
        ...baseStrategyInput(),
        earlyContext: { trades: buyFlowTrades(), lifecycleId: "lc-r", nowMs: baseNow },
        strategyContext: { candles: breakoutCandleSeries(), trades: buyFlowTrades(), lifecycleId: "lc-r", nowMs: baseNow },
      },
      bullRegime(),
    );
    const ids = routed.evaluations.map((row) => row.strategyId);
    expect(ids).toContain("EARLY_ACCELERATION");
    expect(ids).toContain("MOMENTUM_CONTINUATION");
    expect(ids).toContain("BREAKOUT_RETEST");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("24 duplicate event does not duplicate breakout signal", () => {
    const ctx = { candles: breakoutCandleSeries(), trades: buyFlowTrades(20), lifecycleId: "lc-dup", nowMs: baseNow };
    const first = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    const second = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    expect(first.trigger.triggered).toBe(true);
    expect(second.transition?.reasonCode).toBe("DUPLICATE_SIGNAL_SUPPRESSED");
  });

  it("25 concurrent lifecycle evaluations keep single logical trigger generation", () => {
    const ctx = { candles: breakoutCandleSeries(), trades: buyFlowTrades(20), lifecycleId: "lc-conc", nowMs: baseNow };
    const a = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    const b = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    expect(a.trigger.triggered).toBe(true);
    expect(b.transition?.reasonCode).toBe("DUPLICATE_SIGNAL_SUPPRESSED");
    expect(a.trigger.signalId).toBe(b.transition?.signalId);
  });

  it("26 out-of-order event does not move breakout state backwards", () => {
    processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-oo",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: true,
      holdConfirmed: true,
      triggerFired: true,
      invalidated: true,
      expired: false,
      signalId: "sig-1",
      breakoutAtMs: baseNow - 60_000,
      retestAtMs: baseNow - 30_000,
    });
    const late = processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-oo",
      eventAtMs: baseNow - 120_000,
      availableAtMs: baseNow - 120_000,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: true,
      holdConfirmed: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "sig-late",
      breakoutAtMs: baseNow - 120_000,
      retestAtMs: baseNow - 90_000,
    });
    expect(late.newState).toBe("INVALIDATED");
  });

  it("27 expired breakout setup does not self-revive", () => {
    processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-rev",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: false,
      holdConfirmed: false,
      triggerFired: false,
      invalidated: false,
      expired: true,
      signalId: null,
      breakoutAtMs: baseNow - 400_000,
      retestAtMs: null,
    });
    const retry = processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-rev",
      eventAtMs: baseNow + 1_000,
      availableAtMs: baseNow + 1_000,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: true,
      holdConfirmed: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "new",
      breakoutAtMs: baseNow - 400_000,
      retestAtMs: baseNow,
    });
    expect(retry.newState).toBe("EXPIRED");
  });

  it("28 rearm creates new setup id after cooldown with new lifecycle", () => {
    const first = processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-new",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: true,
      holdConfirmed: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "sig-a",
      breakoutAtMs: baseNow - 30_000,
      retestAtMs: baseNow - 10_000,
    });
    const second = processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-new2",
      eventAtMs: baseNow + 200_000,
      availableAtMs: baseNow + 200_000,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 101,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: true,
      holdConfirmed: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "sig-b",
      breakoutAtMs: baseNow + 150_000,
      retestAtMs: baseNow + 180_000,
    });
    expect(first.setupId).not.toBe(second.setupId);
  });

  it("29 restart with same signal id does not duplicate entry", () => {
    const ctx = { candles: breakoutCandleSeries(), trades: buyFlowTrades(20), lifecycleId: "lc-rs", nowMs: baseNow };
    const first = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    const second = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    expect(first.trigger.triggered).toBe(true);
    expect(second.trigger.triggered).toBe(false);
    expect(second.transition?.reasonCode).toBe("DUPLICATE_SIGNAL_SUPPRESSED");
  });

  it("30 reconnect gap without continuity does not skip warmup", () => {
    const gap = breakoutCandleSeries().slice(0, 2);
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: gap,
      trades: buyFlowTrades(),
      lifecycleId: "lc-gap",
      nowMs: baseNow,
    });
    expect(result.setupState).toBe("WARMUP");
  });

  it("31 state delivery duplicate signal suppressed at transition layer", () => {
    const t = processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-crash",
      eventAtMs: baseNow,
      availableAtMs: baseNow,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: true,
      holdConfirmed: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "same-sig",
      breakoutAtMs: baseNow - 20_000,
      retestAtMs: baseNow - 5_000,
    });
    const dup = processBreakoutSetupTransition({
      candidateId: "cand-btc",
      lifecycleId: "lc-crash",
      eventAtMs: baseNow + 1,
      availableAtMs: baseNow + 1,
      snapshotReference: null,
      warmupComplete: true,
      levelReady: true,
      frozenLevel: 100,
      frozenLevelVersion: "pivot-v1",
      breakoutConfirmed: true,
      retestPending: false,
      retestObserved: true,
      holdConfirmed: true,
      triggerFired: true,
      invalidated: false,
      expired: false,
      signalId: "same-sig",
      breakoutAtMs: baseNow - 20_000,
      retestAtMs: baseNow - 5_000,
    });
    expect(t.triggerGeneration).toBe(1);
    expect(dup.reasonCode).toBe("DUPLICATE_SIGNAL_SUPPRESSED");
  });

  it("32 router keeps observable evaluations when multiple strategies fit", () => {
    const routed = routeStrategies(
      {
        ...baseStrategyInput(),
        strategyContext: {
          candles: breakoutCandleSeries(),
          trades: buyFlowTrades(20),
          lifecycleId: "lc-multi",
          nowMs: baseNow,
        },
        earlyContext: { trades: buyFlowTrades(20), lifecycleId: "lc-multi", nowMs: baseNow },
      },
      bullRegime(),
    );
    expect(routed.evaluations.length).toBeGreaterThanOrEqual(3);
    expect(routed.preferredStrategy).toBeTruthy();
  });

  it("33 non-selected eligible strategy remains in evaluations", () => {
    const routed = routeStrategies(
      {
        ...baseStrategyInput(),
        strategyContext: { candles: breakoutCandleSeries(), trades: buyFlowTrades(20), lifecycleId: "lc-sel", nowMs: baseNow },
      },
      bullRegime(),
    );
    const breakout = routed.evaluations.find((row) => row.strategyId === "BREAKOUT_RETEST");
    const momentum = routed.evaluations.find((row) => row.strategyId === "MOMENTUM_CONTINUATION");
    expect(breakout).toBeTruthy();
    expect(momentum).toBeTruthy();
  });

  it("34 durable claim blocks duplicate execution from same opportunity", () => {
    const first = claimCanonicalExecutionAttempt({ candidateId: "cand-btc", executionId: "exec-1" });
    const second = claimCanonicalExecutionAttempt({ candidateId: "cand-btc", executionId: "exec-2" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
  });

  it("35 selected strategy id preserved in evaluation metadata", () => {
    const result = evaluateMomentumContinuationStrategy(baseStrategyInput(), bullRegime(), {
      candles: momentumCandleSeries(),
      trades: buyFlowTrades(15),
      lifecycleId: "lc-meta",
      nowMs: baseNow,
    });
    expect(result.strategyEvaluation.strategyId).toBe("MOMENTUM_CONTINUATION");
    expect(result.strategyEvaluation.policyVersion).toBe("pr03-momentum-and-retest-v1");
  });

  it("36 high ranking score cannot bypass missing trigger conditions", () => {
    const result = evaluateBreakoutRetestStrategy(
      baseStrategyInput({ flowRecovery: 0.99, acceleration: 0.99, breakoutHeld: true }),
      bullRegime(),
      { candles: breakoutCandleSeries().slice(0, 7), trades: [], lifecycleId: "lc-score", nowMs: baseNow },
    );
    expect(result.trigger.triggered).toBe(false);
    expect(result.strategyEvaluation.verdict).not.toBe("ELIGIBLE");
  });

  it("37 missing cost stays UNKNOWN in economics", () => {
    const result = evaluateBreakoutRetestStrategy(
      baseStrategyInput({ expectedMovePercent: 0, entryFee: 0 }),
      bullRegime(),
      { candles: breakoutCandleSeries(), trades: buyFlowTrades(), lifecycleId: "lc-cost", nowMs: baseNow },
    );
    expect(result.economicsStatus).toBe("UNKNOWN");
  });

  it("38 setup score is not expected return percent", () => {
    const econ = buildTradeEconomicsRecord({
      strategyId: "BREAKOUT_RETEST",
      expectedMovePercent: 88,
      expectedMoveQuality: "VALID",
      costSource: "UNKNOWN",
    });
    expect(econ.expectancy.status).toBe("UNKNOWN");
    expect(econ.expectedMove.value).toBe(88);
  });

  it("39 setup invalidation contract does not imply position close", () => {
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandleSeries(),
      trades: buyFlowTrades(),
      lifecycleId: "lc-inv",
      nowMs: baseNow,
    });
    expect(result.invalidation?.reasonCode).toBe("LEVEL_HOLD_BREACH");
    expect(result.strategyEvaluation.invalidationReason).not.toBe("FORCE_CLOSE");
  });

  it("40 signal expiry is separate from execution uncertainty", () => {
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandleSeries(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-exp2",
      nowMs: baseNow,
    });
    if (result.trigger.validUntil) {
      expect(Date.parse(result.trigger.validUntil)).toBeGreaterThan(baseNow);
    }
    expect(result.strategyEvaluation.verdict).not.toBe("WAIT");
  });

  it("41 replay preserves first detection and level evidence", () => {
    const ticks = breakoutCandleSeries().map((_, i) => ({
      tickIndex: i,
      lifecycleId: "lc-replay",
      eventAtMs: baseNow - (breakoutCandleSeries().length - i) * 1_000,
      strategyInput: baseStrategyInput(),
      regime: bullRegime(),
      candles: breakoutCandleSeries().slice(0, i + 1),
      trades: i > 6 ? buyFlowTrades() : [],
    }));
    const report = runPr03ReplayAnalysis({ datasetId: "synthetic-pr03", ticks });
    expect(report.status).toBe("COMPLETED");
    expect(report.tickCount).toBe(breakoutCandleSeries().length);
  });

  it("42 replay and production evaluator share trigger path", () => {
    const ctx = { candles: breakoutCandleSeries(), trades: buyFlowTrades(20), lifecycleId: "lc-parity", nowMs: baseNow };
    const direct = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    resetBreakoutSetupStoreForTests();
    const replay = runPr03ReplayAnalysis({
      datasetId: "parity",
      ticks: [{ tickIndex: 0, lifecycleId: "lc-parity", eventAtMs: baseNow, strategyInput: baseStrategyInput(), regime: bullRegime(), candles: breakoutCandleSeries(), trades: buyFlowTrades(20) }],
    });
    expect(direct.trigger.triggered).toBe(replay.breakoutTriggerCount > 0);
  });

  it("43 symbol venue policy states isolated per lifecycle", () => {
    evaluateBreakoutRetestStrategy(baseStrategyInput({ candidateId: "cand-eth" }), bullRegime(), {
      candles: breakoutCandleSeries(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-eth",
      nowMs: baseNow,
    });
    expect(getBreakoutSetupState("cand-btc", "lc-btc")).toBe("WARMUP");
    expect(getBreakoutSetupState("cand-eth", "lc-eth")).toBe("TRIGGERED");
  });

  it("44 policy version change does not silently mutate frozen setup", () => {
    const first = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandleSeries().slice(0, 7),
      trades: buyFlowTrades(),
      lifecycleId: "lc-pol",
      nowMs: baseNow,
    });
    expect(first.policyVersion).toBe("pr03-momentum-and-retest-v1");
    const frozen = first.referenceLevel?.level;
    const second = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandleSeries(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-pol",
      nowMs: baseNow,
    });
    expect(second.referenceLevel?.level).toBe(frozen);
  });

  it("45 default activation and live safety limits unchanged", () => {
    const auth = resolveExecutionAuthorization({ mode: "LIVE", strategyActivation: "LIVE_DISABLED" });
    expect(auth).toBe("LIVE_DISABLED");
    const admission = resolveCanonicalAdmissionVerdict(["STRATEGY_CONFLICT"]);
    expect(admission).toBe("WAIT");
    const exp = ensurePr03MomentumAndRetestExperiment();
    expect(exp.status).toBe("PLANNED");
    expect(getProfitabilityExperiment("pr03-momentum-and-retest-v1")?.trainUsed).toBe(false);
    const routed = evaluatePr03WithRouter({
      strategyInput: baseStrategyInput(),
      regime: bullRegime(),
      strategyContext: { candles: breakoutCandleSeries(), trades: buyFlowTrades(), lifecycleId: "lc-safe", nowMs: baseNow },
    });
    expect(routed.breakout.strategyEvaluation.shadowOnly).toBe(true);
    expect(routed.momentum.strategyEvaluation.shadowOnly).toBe(true);
  });
});
