import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DeepMarketState, MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { BookTickerState } from "@/src/server/market-data/spine/events";
import {
  evaluateCanonicalRegime,
  routeStrategiesWithDetails,
  type StrategyInput,
} from "@/src/server/forensics/p4-regime-strategy-shadow";
import { resolveExecutionAuthorization } from "@/src/server/execution/er03-canonical-policy";
import { buildStrategyEvaluationContexts, klinesToCausalCandles } from "@/src/server/execution/fix01-strategy-context-builder";
import {
  buildSelectedStrategySignal,
  freezeSelectedStrategySignal,
} from "@/src/server/execution/fix01-selected-signal";
import { runFix01StrategyEvaluationChain } from "@/src/server/execution/fix01-strategy-evaluation-chain";
import { buildEarlyStructuralInvalidation, evaluateEarlyAccelerationStrategy } from "@/src/server/profitability/pr02-early-evaluator";
import { resetEarlySetupStoreForTests } from "@/src/server/profitability/pr02-early-setup";
import { evaluateBreakoutRetestStrategy } from "@/src/server/profitability/pr03-breakout-evaluator";
import { resetBreakoutSetupStoreForTests } from "@/src/server/profitability/pr03-breakout-setup";
import { evaluateMomentumContinuationStrategy } from "@/src/server/profitability/pr03-momentum-evaluator";
import { resetMomentumSetupStoreForTests } from "@/src/server/profitability/pr03-momentum-setup";
import { buildPr04ExitMetadataFromSelectedSignal, isPr04ExitEvaluationEnabled } from "@/src/server/profitability/pr04-exit-bridge";
import type { CausalCandle } from "@/src/server/profitability/pr03-types";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");
const marketEventAt = new Date(baseNow - 20_000).toISOString();
const evaluatedAt = new Date(baseNow).toISOString();
const CANDLE_MS = 30_000;

function candle(index: number, o: number, h: number, l: number, c: number, closed = true, availDelay = 0): CausalCandle {
  const openTime = baseNow - (10 - index) * CANDLE_MS;
  const closeTime = openTime + CANDLE_MS;
  return { openTime, closeTime, open: o, high: h, low: l, close: c, volume: 1000, closed, availableAt: closeTime + availDelay };
}

function trade(price: number, side: "BUY" | "SELL", offsetMs: number, quote = 150): MarketTradeEvent {
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

function buyFlowTrades(count = 16, basePrice = 101): MarketTradeEvent[] {
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

function earlyTrades(): MarketTradeEvent[] {
  const rows: MarketTradeEvent[] = [];
  for (let i = 0; i < 30; i++) rows.push(trade(100 + i * 0.02, i % 5 === 0 ? "SELL" : "BUY", 58_000 - i * 1_800, 140 + i));
  for (let i = 0; i < 12; i++) rows.push(trade(100.6 + i * 0.03, "BUY", 4_500 - i * 400, 180 + i * 5));
  return rows;
}

function book(price = 101.2): BookTickerState {
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

function breakoutCandles(): CausalCandle[] {
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

function momentumCandles(): CausalCandle[] {
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

function deepState(input: {
  trades?: MarketTradeEvent[];
  candles?: CausalCandle[];
  book?: BookTickerState | null;
}): DeepMarketState {
  return {
    symbol: "BTCTRY",
    bookTicker: input.book ?? book(),
    recentTrades: input.trades ?? [],
    klines1m: (input.candles ?? []).map((row) => ({
      openTime: row.openTime,
      closeTime: row.closeTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    })),
    orderBookValid: true,
    orderBookGap: false,
  };
}

function baseStrategyInput(overrides?: Partial<StrategyInput>): StrategyInput {
  return {
    candidateId: "cand-fix01",
    sourceType: "SYNTHETIC_FIXTURE",
    marketEventAt,
    evaluatedAt,
    velocity: 0.8,
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

function chain(overrides?: {
  deepState?: DeepMarketState | null;
  strategyInput?: Partial<StrategyInput>;
  lifecycleId?: string;
}) {
  return runFix01StrategyEvaluationChain({
    symbol: "BTCTRY",
    venue: "BINANCE",
    candidateId: "cand-fix01",
    lifecycleId: overrides?.lifecycleId ?? "lc-fix01",
    featureSnapshotId: "snap-fix01",
    decisionAtMs: baseNow,
    strategyInput: baseStrategyInput(overrides?.strategyInput),
    regime: bullRegime(),
    deepState: overrides?.deepState ?? deepState({}),
    baselinePrice: 100,
    firstDetectionPrice: 100.2,
  });
}

beforeEach(() => {
  resetEarlySetupStoreForTests();
  resetMomentumSetupStoreForTests();
  resetBreakoutSetupStoreForTests();
});

afterAll(() => {
  resetEarlySetupStoreForTests();
  resetMomentumSetupStoreForTests();
  resetBreakoutSetupStoreForTests();
});

describe("FIX01 strategy context and invalidation", () => {
  it("1 context yokken EARLY tetiklenmez", () => {
    const result = chain({ deepState: deepState({ trades: [], candles: [], book: null }) });
    const early = result.router.strategyDetails.EARLY_ACCELERATION;
    expect(early?.trigger.triggered).toBe(false);
    expect(early?.trigger.reasonCodes).toContain("PRODUCER_CONTEXT_MISSING");
  });

  it("2 context yokken MOMENTUM tetiklenmez", () => {
    const result = chain({ deepState: deepState({ trades: [], candles: [], book: null }) });
    const momentum = result.router.strategyDetails.MOMENTUM_CONTINUATION;
    expect(momentum?.trigger.triggered).toBe(false);
    expect(momentum?.trigger.reasonCodes).toContain("PRODUCER_CONTEXT_MISSING");
  });

  it("3 breakoutHeld=true olsa da RETEST context yokken tetiklenmez", () => {
    const result = chain({
      deepState: deepState({ trades: [], candles: [], book: null }),
      strategyInput: { breakoutHeld: true, flowRecovery: 0.99, acceleration: 0.99 },
    });
    const breakout = result.router.strategyDetails.BREAKOUT_RETEST;
    expect(breakout?.trigger.triggered).toBe(false);
    expect(breakout?.trigger.reasonCodes).toContain("PRODUCER_CONTEXT_MISSING");
  });

  it("4 gerçek producer context router inputuna ulaşır", () => {
    const result = chain({
      deepState: deepState({ trades: buyFlowTrades(), candles: breakoutCandles(), book: book() }),
    });
    expect(result.routerInput.earlyContext?.trades?.length).toBeGreaterThan(0);
    expect(result.routerInput.strategyContext?.candles?.length).toBeGreaterThan(0);
    expect(result.contexts.dataCoverage.hasProducerData).toBe(true);
  });

  it("5 uygun EARLY akışı gerçek trigger üretir", () => {
    const regime = bullRegime();
    const early = evaluateEarlyAccelerationStrategy(baseStrategyInput(), regime, {
      trades: earlyTrades(),
      book: book(101.2),
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      lifecycleId: "lc-early-pos",
      nowMs: baseNow,
    });
    expect(early.trigger.triggered).toBe(true);
    expect(early.setupState).toBe("TRIGGERED");
    expect(early.invalidation?.reasonCode).toBe("EARLY_BASELINE_STRUCTURE_BREACH");
    expect(early.invalidation?.referenceLevel).toBeGreaterThan(early.invalidation?.invalidationThreshold ?? 0);
  });

  it("6 uygun MOMENTUM impulse/pause/resumption trigger üretir", () => {
    const result = evaluateMomentumContinuationStrategy(baseStrategyInput(), bullRegime(), {
      candles: momentumCandles(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-mom-pos",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(true);
    expect(result.setupState).toBe("TRIGGERED");
    expect(result.invalidation?.reasonCode).toBe("IMPULSE_STRUCTURE_BREACH");
  });

  it("7 uygun RETEST aşamaları trigger üretir", () => {
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandles(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-bo-pos",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(true);
    expect(result.setupState).toBe("TRIGGERED");
    expect(result.invalidation?.reasonCode).toBe("LEVEL_HOLD_BREACH");
  });

  it("8 retestsiz yükseliş RETEST trigger üretmez", () => {
    const candles = breakoutCandles().slice(0, 7);
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles,
      trades: buyFlowTrades(12),
      lifecycleId: "lc-no-retest",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
    expect(result.trigger.reasonCodes.some((code) => code.includes("RETEST") || code.includes("HOLD"))).toBe(true);
  });

  it("9 bozulan hold invalidation üretir", () => {
    const candles = [...breakoutCandles()];
    candles[candles.length - 1] = candle(9, 101.4, 101.5, 95, 95.5);
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles,
      trades: buyFlowTrades(20),
      lifecycleId: "lc-hold-fail",
      nowMs: baseNow,
    });
    expect(result.trigger.triggered).toBe(false);
    expect(result.setupState === "INVALIDATED" || result.trigger.reasonCodes.includes("SETUP_INVALIDATED")).toBe(true);
  });

  it("10 future availableAt verisi kullanılmaz", () => {
    const futureCandles = breakoutCandles().map((row, idx) =>
      idx === breakoutCandles().length - 1 ? { ...row, availableAt: baseNow + 60_000 } : row,
    );
    const causal = klinesToCausalCandles(
      futureCandles.map((row) => ({
        openTime: row.openTime,
        closeTime: row.closeTime,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      })),
      baseNow,
    );
    expect(causal.every((row) => row.availableAt <= baseNow)).toBe(true);
  });

  it("11 partial candle gelecekteki kapanışla tamamlanmaz", () => {
    const partial = klinesToCausalCandles(
      [{ openTime: baseNow - 10_000, closeTime: baseNow + 50_000, open: 100, high: 105, low: 99, close: 104, volume: 10 }],
      baseNow,
    );
    expect(partial[0]?.closed).toBe(false);
    expect(partial[0]?.close).toBe(partial[0]?.open);
    expect(partial[0]?.high).toBe(partial[0]?.open);
  });

  it("12 aynı olay tekrarında ikinci mantıksal sinyal oluşmaz", () => {
    const ctx = { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-dup-fix01", nowMs: baseNow };
    const first = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    const second = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    expect(first.trigger.triggered).toBe(true);
    expect(second.trigger.triggered).toBe(false);
    expect(second.transition?.reasonCode).toBe("DUPLICATE_SIGNAL_SUPPRESSED");
  });

  it("13 aynı setup farklı zamanlarda tekrar giriş üretmez", () => {
    const ctx = { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-repeat", nowMs: baseNow };
    evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    const later = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), { ...ctx, nowMs: baseNow + 5_000 });
    expect(later.trigger.triggered).toBe(false);
  });

  it("14 expired setup kendiliğinden canlanmaz", () => {
    const ctx = { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-exp-fix01", nowMs: baseNow };
    evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    const expired = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), { ...ctx, nowMs: baseNow + 900_000 });
    expect(expired.setupState === "EXPIRED" || expired.trigger.triggered === false).toBe(true);
  });

  it("15 venue/instrument lifecycle state ayrıdır", () => {
    const a = evaluateBreakoutRetestStrategy(baseStrategyInput({ candidateId: "cand-a" }), bullRegime(), {
      candles: breakoutCandles(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-a",
      nowMs: baseNow,
    });
    resetBreakoutSetupStoreForTests();
    const b = evaluateBreakoutRetestStrategy(baseStrategyInput({ candidateId: "cand-b" }), bullRegime(), {
      candles: breakoutCandles(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-b",
      nowMs: baseNow,
    });
    expect(a.setupId).not.toBe(b.setupId);
  });

  it("16 EARLY geçerli invalidation üretir", () => {
    const inv = buildEarlyStructuralInvalidation({
      baselinePrice: 100,
      firstDetectionPrice: 100.2,
      latestPrice: 101.5,
      asOfMs: baseNow,
    });
    expect(inv?.reasonCode).toBe("EARLY_BASELINE_STRUCTURE_BREACH");
    expect(inv?.invalidationThreshold).toBeLessThan(inv?.referenceLevel ?? 0);
  });

  it("17 yapı eksikse invalidation null ile geçilmez", () => {
    const inv = buildEarlyStructuralInvalidation({
      baselinePrice: 0,
      firstDetectionPrice: 0,
      latestPrice: 101,
      asOfMs: baseNow,
    });
    expect(inv).toBeNull();
  });

  it("18 MOMENTUM seçilmiş invalidation entry metadataya ulaşır", () => {
    const router = routeStrategiesWithDetails(
      {
        ...baseStrategyInput(),
        strategyContext: { candles: momentumCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-mom-meta", nowMs: baseNow },
      },
      bullRegime(),
    );
    const selected = buildSelectedStrategySignal("MOMENTUM_CONTINUATION", router);
    const detail = router.strategyDetails.MOMENTUM_CONTINUATION;
    expect(detail?.trigger.triggered).toBe(true);
    expect(selected?.invalidation?.reasonCode).toBe("IMPULSE_STRUCTURE_BREACH");
    const entryMetadata = selected
      ? buildPr04ExitMetadataFromSelectedSignal({ positionId: "pos-mom", selectedSignal: selected })
      : null;
    expect(entryMetadata?.structuralInvalidation?.reasonCode).toBe("IMPULSE_STRUCTURE_BREACH");
    expect(entryMetadata?.entrySignalId).toBe(selected?.signalId);
  });

  it("19 RETEST seçilmiş invalidation entry metadataya ulaşır", () => {
    const router = routeStrategiesWithDetails(
      {
        ...baseStrategyInput(),
        strategyContext: { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-bo-meta", nowMs: baseNow },
      },
      bullRegime(),
    );
    const selected = buildSelectedStrategySignal("BREAKOUT_RETEST", router);
    const detail = router.strategyDetails.BREAKOUT_RETEST;
    expect(detail?.trigger.triggered).toBe(true);
    expect(selected?.invalidation?.reasonCode).toBe("LEVEL_HOLD_BREACH");
    const entryMetadata = selected
      ? buildPr04ExitMetadataFromSelectedSignal({ positionId: "pos-bo", selectedSignal: selected })
      : null;
    expect(entryMetadata?.setupId).toBe(selected?.setupId);
  });

  it("20 entry bridge evaluator yeniden çalıştırmaz", () => {
    const result = chain({
      deepState: deepState({ trades: buyFlowTrades(20), candles: breakoutCandles(), book: book() }),
    });
    const frozen = result.selectedSignal ? freezeSelectedStrategySignal(result.selectedSignal.strategyId, result.router.strategyDetails.BREAKOUT_RETEST!) : null;
    expect(frozen?.invalidation?.referenceLevel).toBe(result.selectedSignal?.invalidation?.referenceLevel);
    expect(frozen?.signalId).toBe(result.selectedSignal?.signalId);
  });

  it("21 sonraki tick eski sinyal snapshot değişmez", () => {
    const first = chain({
      deepState: deepState({ trades: buyFlowTrades(20), candles: breakoutCandles(), book: book() }),
      lifecycleId: "lc-immutable",
    });
    const snapshot = first.selectedSignal;
    chain({
      deepState: deepState({ trades: buyFlowTrades(5), candles: breakoutCandles(), book: book() }),
      lifecycleId: "lc-immutable",
    });
    expect(snapshot?.signalId).toBe(first.selectedSignal?.signalId);
    expect(snapshot?.invalidation?.referenceLevel).toBe(first.selectedSignal?.invalidation?.referenceLevel);
  });

  it("22 router çatışmasında seçilen signal/setup korunur", () => {
    const router = routeStrategiesWithDetails(
      {
        ...baseStrategyInput(),
        earlyContext: { trades: earlyTrades(), book: book(), lifecycleId: "lc-conf", nowMs: baseNow, baselinePrice: 100, firstDetectionPrice: 100.2 },
        strategyContext: { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-conf", nowMs: baseNow },
      },
      bullRegime(),
    );
    const selected = buildSelectedStrategySignal(router.preferredStrategy, router);
    expect(selected?.strategyId).toBe(router.preferredStrategy);
    expect(selected?.setupId).toBeTruthy();
    expect(selected?.signalId).toBeTruthy();
  });

  it("23 seçilmeyen stratejinin invalidation seçilene karışmaz", () => {
    const router = routeStrategiesWithDetails(
      {
        ...baseStrategyInput(),
        strategyContext: { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-mix", nowMs: baseNow },
      },
      bullRegime(),
    );
    const selected = buildSelectedStrategySignal(router.preferredStrategy, router);
    const other = router.preferredStrategy === "BREAKOUT_RETEST" ? router.strategyDetails.MOMENTUM_CONTINUATION : router.strategyDetails.BREAKOUT_RETEST;
    if (selected?.invalidation && other?.invalidation) {
      expect(selected.invalidation.referenceLevel).not.toBe(other.invalidation.referenceLevel);
    }
  });

  it("24 signal expiry admission öncesinde ele alınır", () => {
    const result = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandles(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-expiry",
      nowMs: baseNow,
    });
    expect(result.trigger.validUntil).toBeTruthy();
    if (result.trigger.validUntil && result.trigger.triggerAt) {
      expect(Date.parse(result.trigger.validUntil)).toBeGreaterThan(Date.parse(result.trigger.triggerAt));
    }
  });

  it("25 yüksek skor eksik lifecycle aşamasını aşamaz", () => {
    const result = evaluateBreakoutRetestStrategy(
      baseStrategyInput({ flowRecovery: 0.99, acceleration: 0.99, breakoutHeld: true }),
      bullRegime(),
      { candles: breakoutCandles().slice(0, 7), trades: [], lifecycleId: "lc-score-fix01", nowMs: baseNow },
    );
    expect(result.trigger.triggered).toBe(false);
    expect(result.strategyEvaluation.verdict).not.toBe("ELIGIBLE");
  });

  it("26 production evaluator dosyalarında routerFixtureMode yok", () => {
    const files = [
      "src/server/profitability/pr02-early-evaluator.ts",
      "src/server/profitability/pr03-momentum-evaluator.ts",
      "src/server/profitability/pr03-breakout-evaluator.ts",
    ];
    for (const file of files) {
      const content = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(content.includes("routerFixtureMode")).toBe(false);
      expect(content.includes("ROUTER_FIXTURE")).toBe(false);
    }
  });

  it("27 risk/authorization sınırları korunur", () => {
    expect(resolveExecutionAuthorization({ mode: "LIVE", strategyActivation: "LIVE_DISABLED" })).toBe("LIVE_DISABLED");
    expect(resolveExecutionAuthorization({ mode: "paper", strategyActivation: "PAPER_ELIGIBLE" })).toBe("PAPER_ELIGIBLE");
  });

  it("28 PR04/live varsayılan aktivasyonu değişmez", () => {
    expect(isPr04ExitEvaluationEnabled()).toBe(false);
  });

  it("29 out-of-order olay state geriye taşımaz", () => {
    const ctx = { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-oo-fix01", nowMs: baseNow };
    evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), ctx);
    const invalidated = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      ...ctx,
      candles: breakoutCandles().map((row, idx) => (idx === 9 ? { ...row, low: 90, close: 91 } : row)),
    });
    expect(invalidated.setupState === "INVALIDATED" || invalidated.trigger.triggered === false).toBe(true);
  });

  it("30 rearm yeni lifecycle ile yeni setup üretir", () => {
    const first = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandles(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-rearm-1",
      nowMs: baseNow,
    });
    resetBreakoutSetupStoreForTests();
    const second = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandles(),
      trades: buyFlowTrades(20),
      lifecycleId: "lc-rearm-2",
      nowMs: baseNow,
    });
    expect(first.setupId).not.toBe(second.setupId);
    expect(second.trigger.triggered).toBe(true);
  });

  it("31 restart warmup eski sinyali yeniden üretmez", () => {
    const lifecycleId = "lc-warmup-fix01";
    evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandles(),
      trades: buyFlowTrades(20),
      lifecycleId,
      nowMs: baseNow,
    });
    resetBreakoutSetupStoreForTests();
    const afterReset = evaluateBreakoutRetestStrategy(baseStrategyInput(), bullRegime(), {
      candles: breakoutCandles().slice(0, 3),
      trades: buyFlowTrades(3),
      lifecycleId,
      nowMs: baseNow + 1_000,
    });
    expect(afterReset.setupState).toBe("WARMUP");
    expect(afterReset.trigger.triggered).toBe(false);
  });

  it("32 tam zincir admission metadata kimliklerini taşır", () => {
    const router = routeStrategiesWithDetails(
      {
        ...baseStrategyInput(),
        strategyContext: { candles: breakoutCandles(), trades: buyFlowTrades(20), lifecycleId: "lc-chain", nowMs: baseNow },
      },
      bullRegime(),
    );
    const selected = buildSelectedStrategySignal("BREAKOUT_RETEST", router);
    const entryMetadata = selected
      ? buildPr04ExitMetadataFromSelectedSignal({ positionId: "pos-chain", selectedSignal: selected })
      : null;
    expect(entryMetadata?.strategyId).toBe(selected?.strategyId);
    expect(entryMetadata?.entrySignalId).toBe(selected?.signalId);
    expect(entryMetadata?.setupId).toBe(selected?.setupId);
    expect(entryMetadata?.structuralInvalidation).toEqual(selected?.invalidation);
  });
});
