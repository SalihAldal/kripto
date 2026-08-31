import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpportunityCandidate } from "@/src/server/opportunity/types";
import type { SymbolMarketSnapshot, RollingMetrics, MarketTradeEvent, BookTickerState } from "@/src/server/market-data/spine/events";
import { OpportunityEngine, resetOpportunityEngineForTests } from "@/src/server/opportunity/opportunity-engine";
import {
  MicrostructureEngine,
  resetMicrostructureEngineForTests,
} from "@/src/server/microstructure/microstructure-engine";
import { resetMarketDataDaemonForTests } from "@/src/server/market-data/spine/market-data-daemon";
import {
  computeHorizons,
  computeReachTimes,
  moveKey,
} from "@/src/server/shadow-outcome/metrics";
import { detectMoverEvents } from "@/src/server/shadow-outcome/mover-truth";
import {
  classifyMiss,
  earlyRecall,
  liveCandidates,
  moverRecall,
  precisionAt,
  precisionAtK,
  scoreCalibration,
  uniqueByMove,
  aiValue,
} from "@/src/server/shadow-outcome/analytics";
import { getDailyEdgeReport } from "@/src/server/shadow-outcome/reports";
import {
  ShadowOutcomeEngine,
  resetShadowOutcomeEngineForTests,
  SHADOW_OUTCOME_ORDERS_DISABLED,
} from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { CANONICAL_CALL_CHAIN, SERVICE_RUNTIME_CLASS } from "@/src/server/hot-path/canonical-pipeline";

const T0 = 1_700_000_000_000;

function rolling(overrides: Partial<RollingMetrics> = {}): RollingMetrics {
  return {
    return1s: 0,
    return5s: 0,
    return15s: 0,
    return30s: 0,
    return1m: 0,
    return3m: 0,
    return5m: 0,
    return15m: 0,
    volumeDelta: 0,
    quoteVolumeDelta: 50_000,
    ...overrides,
  };
}

function snap(symbol: string, input: Partial<SymbolMarketSnapshot> & { rolling?: Partial<RollingMetrics> } = {}): SymbolMarketSnapshot {
  const { rolling: rollingOver, ...rest } = input;
  return {
    symbol,
    lastPrice: 100,
    previousPrice: 99.5,
    openPrice: 99,
    change24h: 1,
    high24h: 102,
    low24h: 97,
    quoteVolume24h: 5_000_000,
    baseVolume24h: 50_000,
    eventTime: T0,
    localReceiveTime: T0,
    lastUpdateAt: T0,
    stale: false,
    rolling: rolling(rollingOver),
    ...rest,
  };
}

function opp(symbol = "AAAUSDT", extra: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  return {
    candidateId: extra.candidateId ?? `${symbol}:${extra.firstDetectedAt ?? T0}`,
    symbol,
    primaryLane: "EARLY",
    secondaryEvidence: [],
    score: 82,
    laneScores: { EARLY: 82, STEADY: 60, MOMENTUM: 40, CONTINUATION: 20 },
    breakdown: {
      priceVelocity: 18,
      priceAcceleration: 20,
      volumeAcceleration: 14,
      relativeVolume: 12,
      relativeStrength: 8,
      breakout: 6,
      compressionExpansion: 4,
      consistency: 6,
      retracementQuality: 5,
      exhaustion: -2,
      chaseControl: -1,
      liquidity: 8,
    },
    features: {
      return1s: 0.1,
      return5s: 0.3,
      return15s: 0.5,
      return30s: 0.7,
      return1m: 0.9,
      return3m: 1.1,
      return5m: 1.3,
      return15m: 1.6,
      change24h: 1.2,
      velocity5s: 1.2,
      velocity15s: 0.8,
      velocity30s: 0.5,
      velocity1m: 0.4,
      priceAccelerationShort: 0.6,
      priceAccelerationMedium: 0.3,
      accelerationConsistency: 0.5,
      volume1m: 120_000,
      volume3m: 200_000,
      volume5m: 280_000,
      rvol1m: 2.4,
      rvol3m: 1.8,
      rvol5m: 1.5,
      volumeAcceleration: 40_000,
      relativeStrengthBTC1m: 0.7,
      relativeStrengthBTC5m: 0.9,
      relativeStrengthMarket: 0.6,
      distanceTo3mHigh: 0.1,
      distanceTo5mHigh: 0.12,
      breakout3m: 0.4,
      breakout5m: 0.3,
      compressionScore: 0.4,
      expansionScore: 0.5,
      maxRetracement: 0.2,
      retracementRatio: 0.1,
      recoverySpeed: 0.4,
      momentumConsistency: 0.6,
      exhaustionScore: 8,
      chaseRisk: 2,
      quoteVolume24h: 5_000_000,
    },
    reasonCodes: ["EARLY_PRICE_ACCELERATION"],
    state: "DISCOVERED",
    firstDetectedAt: T0,
    firstDetectionPrice: 1,
    lastScoreAt: T0,
    lastEvidenceAt: T0,
    currentPrice: 1,
    scansWithoutEvidence: 0,
    deepSubscribed: false,
    ...extra,
  };
}

function ramp(from: number, to: number, n: number, start = T0, stepMs = 60_000) {
  return Array.from({ length: n }, (_, i) => {
    const t = start + i * stepMs;
    const price = from + ((to - from) * i) / Math.max(1, n - 1);
    return { t, price, high: price, low: price };
  });
}

function trade(input: { side: "BUY" | "SELL"; notional: number; price?: number; t?: number; symbol?: string }): MarketTradeEvent {
  const price = input.price ?? 100;
  return {
    type: "trade",
    symbol: input.symbol ?? "AAAUSDT",
    price,
    quantity: input.notional / price,
    quoteNotional: input.notional,
    eventTime: input.t ?? T0,
    tradeTime: input.t ?? T0,
    receiveTime: input.t ?? T0,
    buyerMaker: input.side === "SELL",
    takerSide: input.side,
    source: "memory",
  };
}

function book(): BookTickerState {
  return {
    symbol: "AAAUSDT",
    bestBid: 99.98,
    bestBidQty: 500,
    bestAsk: 100.02,
    bestAskQty: 120,
    spreadAbsolute: 0.04,
    spreadBps: 4,
    eventTime: T0,
    lastUpdateAt: T0,
    stale: false,
  };
}

describe("phase 05 shadow outcome engine", () => {
  afterEach(() => {
    resetShadowOutcomeEngineForTests();
    resetOpportunityEngineForTests();
    resetMicrostructureEngineForTests();
    resetMarketDataDaemonForTests().stop();
  });

  it("1 MFE is detection-to-high percent", () => {
    const out = computeHorizons({
      detectedAt: T0,
      detectionPrice: 1,
      points: [
        { t: T0, price: 1 },
        { t: T0 + 10 * 60_000, price: 1.04 },
        { t: T0 + 20 * 60_000, price: 1.087 },
        { t: T0 + 30 * 60_000, price: 1.05 },
      ],
      now: T0 + 30 * 60_000,
      gapMs: 15 * 60_000,
    });
    const m30 = out.find((row) => row.horizonMin === 30)!;
    expect(m30.quality).toBe("OK");
    expect(m30.mfePct).toBeCloseTo(8.7, 3);
  });

  it("2 MAE is detection-to-low percent", () => {
    const out = computeHorizons({
      detectedAt: T0,
      detectionPrice: 1,
      points: [
        { t: T0, price: 1 },
        { t: T0 + 8 * 60_000, price: 0.982 },
        { t: T0 + 30 * 60_000, price: 1.01 },
      ],
      now: T0 + 30 * 60_000,
      gapMs: 25 * 60_000,
    });
    expect(out.find((row) => row.horizonMin === 30)!.maePct).toBeCloseTo(-1.8, 3);
  });

  it("3 final return is end-of-window change, not MFE", () => {
    const out = computeHorizons({
      detectedAt: T0,
      detectionPrice: 1,
      points: [
        { t: T0, price: 1 },
        { t: T0 + 10 * 60_000, price: 1.08 },
        { t: T0 + 30 * 60_000, price: 1.02 },
      ],
      now: T0 + 30 * 60_000,
      gapMs: 25 * 60_000,
    });
    const m30 = out.find((row) => row.horizonMin === 30)!;
    expect(m30.mfePct).toBeCloseTo(8, 3);
    expect(m30.returnPct).toBeCloseTo(2, 3);
    expect(m30.mfePct).not.toBe(m30.returnPct);
  });

  it("4 timeToMFE is peak timestamp minus detection", () => {
    const peakAt = T0 + 23 * 60_000 + 14_000;
    const out = computeHorizons({
      detectedAt: T0,
      detectionPrice: 1,
      points: [
        { t: T0, price: 1 },
        { t: peakAt, price: 1.124 },
        { t: T0 + 60 * 60_000, price: 1.08 },
      ],
      now: T0 + 60 * 60_000,
      gapMs: 40 * 60_000,
    });
    expect(out.find((row) => row.horizonMin === 60)!.timeToMfeMs).toBe(peakAt - T0);
  });

  it("5 threshold reach times are first crossing or null", () => {
    const times = computeReachTimes({
      detectedAt: T0,
      detectionPrice: 1,
      points: [
        { t: T0, price: 1 },
        { t: T0 + 4 * 60_000, price: 1.031 },
        { t: T0 + 12 * 60_000, price: 1.052 },
      ],
      now: T0 + 12 * 60_000,
    });
    expect(times.timeTo3Percent).toBe(4 * 60_000);
    expect(times.timeTo5Percent).toBe(12 * 60_000);
    expect(times.timeTo10Percent).toBeNull();
  });

  it("6 first-detection snapshot is immutable", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity([opp("AAAUSDT", { score: 70, firstDetectionPrice: 1.0, state: "DISCOVERED" })], { now: T0, source: "replay" });
    const before = { ...engine.getSnapshot("AAAUSDT:" + T0)! };
    engine.observeOpportunity(
      [opp("AAAUSDT", { score: 91, firstDetectionPrice: 1.4, state: "HOT", firstDetectedAt: T0 })],
      { now: T0 + 8_000, source: "replay" },
    );
    const after = engine.getSnapshot("AAAUSDT:" + T0)!;
    expect(after.firstDetectionPrice).toBe(1.0);
    expect(after.finalScore).toBe(before.finalScore);
    expect(after.opportunityScore).toBe(70);
    expect(Object.isFrozen(after)).toBe(true);
  });

  it("7 candidate journey is preserved", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    const id = "AAAUSDT:" + T0;
    engine.observeOpportunity([opp("AAAUSDT", { candidateId: id, score: 79, state: "DISCOVERED" })], { now: T0 + 2_000 });
    engine.observeOpportunity([opp("AAAUSDT", { candidateId: id, score: 86, state: "DISCOVERED" })], { now: T0 + 8_000 });
    engine.observeOpportunity([opp("AAAUSDT", { candidateId: id, score: 91, state: "HOT" })], { now: T0 + 15_000 });
    engine.observeMicro(
      [
        {
          candidateId: id,
          symbol: "AAAUSDT",
          lane: "EARLY",
          opportunityScore: 91,
          opportunityBreakdown: opp().breakdown,
          microScore: 70,
          microBreakdown: {
            takerBuyRatio: 10,
            buyFlowAcceleration: 8,
            tradeAcceleration: 6,
            askDepletion: 5,
            bidSupport: 4,
            depthImbalance: 3,
            breakoutAcceptance: 4,
            spreadQuality: 5,
            exhaustion: -1,
            divergence: 0,
          },
          liquidityScore: 80,
          executionQuality: 75,
          ai: { status: "READY", decision: "NEUTRAL", modifier: 0, reason: "test" },
          tdi: { role: "SHADOW", decision: "NO_OPINION", agreesWithCanonical: null, canReject: false },
          finalScore: 89,
          smoothedScore: 89,
          rank: 2,
          confidence: 0.7,
          state: "MICRO_CONFIRMED",
          reasonCodes: ["MICRO_STRONG_TAKER_BUY"],
          warnings: [],
          hardReject: null,
          firstDetectedAt: T0,
          firstDetectionPrice: 1,
          hotAt: T0 + 15_000,
          microReadyAt: T0 + 19_000,
          currentPrice: 1.01,
          features: { takerBuyRatio5s: 0.72 } as never,
          deepSubscribed: true,
        },
      ],
      { now: T0 + 19_000 },
    );
    const journey = engine.getJourney(id);
    expect(journey.map((row) => row.stage)).toEqual(["DISCOVERED", "DISCOVERED", "HOT", "MICRO_CONFIRMED"]);
    expect(journey.map((row) => row.score)).toEqual([79, 86, 91, 89]);
  });

  it("8 same-move duplicate candidates do not inflate unique-move precision", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity(
      [
        opp("DUPUSDT", { candidateId: "DUPUSDT:1", firstDetectedAt: T0, score: 80 }),
        opp("DUPUSDT", { candidateId: "DUPUSDT:2", firstDetectedAt: T0 + 60_000, score: 81 }),
      ],
      { now: T0, source: "replay" },
    );
    for (const id of ["DUPUSDT:1", "DUPUSDT:2"]) {
      const session = engine.getTracked().find((row) => row.snapshot.candidateId === id)!;
      for (const point of ramp(1, 1.06, 61, session.snapshot.firstDetectedAt)) {
        engine.ingestPrice("DUPUSDT", point, point.t);
      }
    }
    const all = engine.getTracked();
    expect(all.length).toBe(2);
    expect(uniqueByMove(all).length).toBe(1);
    expect(moveKey("DUPUSDT", T0)).toBe(moveKey("DUPUSDT", T0 + 60_000));
    expect(precisionAt(uniqueByMove(all), 5).n).toBe(1);
    expect(precisionAt(all, 5).n).toBe(2);
  });

  it("9 mover ground truth emits rolling-window events not 24h change", () => {
    const points = ramp(100, 112, 61);
    const events = detectMoverEvents({ symbol: "MOVEUSDT", points, now: T0 + 60 * 60_000 });
    expect(events.some((row) => row.moveClass === 10)).toBe(true);
    expect(events.find((row) => row.moveClass === 10)!.horizonMin).toBe(60);
    expect(events.every((row) => row.moveStartAt <= row.thresholdReachedAt)).toBe(true);
  });

  it("10 mover recall counts detected vs missed", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity([opp("HITUSDT", { candidateId: "HITUSDT:" + T0, firstDetectedAt: T0, firstDetectionPrice: 100 })], {
      now: T0,
      source: "replay",
    });
    const hitPoints = ramp(100, 112, 61);
    for (const point of hitPoints) engine.ingestPrice("HITUSDT", point, point.t);
    for (const point of ramp(50, 56, 61)) engine.ingestPrice("MISSUSDT", point, point.t);
    const movers = [
      ...detectMoverEvents({ symbol: "HITUSDT", points: hitPoints, now: T0 + 60 * 60_000 }),
      ...detectMoverEvents({ symbol: "MISSUSDT", points: ramp(50, 56, 61), now: T0 + 60 * 60_000 }),
    ].filter((row) => row.moveClass === 10);
    const recall = moverRecall(movers, engine.getTracked(), 10);
    expect(recall.n).toBeGreaterThanOrEqual(1);
    expect(recall.detected).toBeGreaterThanOrEqual(1);
    expect(recall.recall).toBeGreaterThan(0);
    expect(recall.recall).toBeLessThanOrEqual(1);
  });

  it("11 early recall requires detection before +3%", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity(
      [opp("EARLYUSDT", { candidateId: "EARLYUSDT:" + T0, firstDetectedAt: T0, firstDetectionPrice: 100.2 })],
      { now: T0, source: "replay" },
    );
    const points = ramp(100, 112, 61);
    const movers = detectMoverEvents({ symbol: "EARLYUSDT", points, now: T0 + 60 * 60_000 }).filter((row) => row.moveClass === 10);
    const early = earlyRecall(movers, engine.getTracked(), 10);
    expect(early.before3.detected).toBeGreaterThanOrEqual(1);
    expect(early.before3.n).toBe(movers.length);
  });

  it("12 precision is successes over usable outcomes", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity(
      [
        opp("WINUSDT", { candidateId: "WINUSDT:" + T0, firstDetectedAt: T0, firstDetectionPrice: 100 }),
        opp("LOSSUSDT", { candidateId: "LOSSUSDT:" + T0, firstDetectedAt: T0, firstDetectionPrice: 100, symbol: "LOSSUSDT" }),
      ],
      { now: T0, source: "replay" },
    );
    for (const point of ramp(100, 108, 61)) engine.ingestPrice("WINUSDT", point, point.t);
    for (const point of ramp(100, 100.4, 61)) engine.ingestPrice("LOSSUSDT", point, point.t);
    const p = precisionAt(engine.getTracked(), 5);
    expect(p.n).toBe(2);
    expect(p.rate).toBe(0.5);
  });

  it("13 Precision@K prefers top ranks", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    const rows = [
      opp("TOPUSDT", { candidateId: "TOPUSDT:" + T0, score: 96, firstDetectionPrice: 100 }),
      opp("MIDUSDT", { candidateId: "MIDUSDT:" + T0, score: 70, symbol: "MIDUSDT", firstDetectionPrice: 100 }),
    ];
    engine.observeOpportunity(rows, { now: T0, source: "replay" });
    engine.observeMicro(
      rows.map((row, index) => ({
        candidateId: row.candidateId,
        symbol: row.symbol,
        lane: "EARLY" as const,
        opportunityScore: row.score,
        opportunityBreakdown: row.breakdown,
        microScore: 60,
        microBreakdown: {
          takerBuyRatio: 1,
          buyFlowAcceleration: 1,
          tradeAcceleration: 1,
          askDepletion: 1,
          bidSupport: 1,
          depthImbalance: 1,
          breakoutAcceptance: 1,
          spreadQuality: 1,
          exhaustion: 0,
          divergence: 0,
        },
        liquidityScore: 70,
        executionQuality: 70,
        ai: { status: "READY" as const, decision: "NEUTRAL" as const, modifier: 0, reason: "" },
        tdi: { role: "SHADOW" as const, decision: "NO_OPINION", agreesWithCanonical: null, canReject: false as const },
        finalScore: row.score,
        smoothedScore: row.score,
        rank: index + 1,
        confidence: 0.5,
        state: "MICRO_CONFIRMED" as const,
        reasonCodes: [],
        warnings: [],
        hardReject: null,
        firstDetectedAt: T0,
        firstDetectionPrice: 100,
        hotAt: T0,
        microReadyAt: T0,
        currentPrice: 100,
        features: { takerBuyRatio5s: 0.6 } as never,
        deepSubscribed: true,
      })),
      { now: T0 },
    );
    for (const point of ramp(100, 110, 61)) engine.ingestPrice("TOPUSDT", point, point.t);
    for (const point of ramp(100, 100.2, 61)) engine.ingestPrice("MIDUSDT", point, point.t);
    const tracked = engine.getTracked();
    expect(precisionAtK(tracked, 1, 5).rate).toBe(1);
    expect(precisionAtK(tracked, 2, 5).rate).toBe(0.5);
  });

  it("14 score buckets group outcomes", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity(
      [
        opp("HIUSDT", { candidateId: "HIUSDT:" + T0, score: 96, symbol: "HIUSDT", firstDetectionPrice: 100 }),
        opp("LOUSDT", { candidateId: "LOUSDT:" + T0, score: 62, symbol: "LOUSDT", firstDetectionPrice: 100 }),
      ],
      { now: T0, source: "replay" },
    );
    for (const point of ramp(100, 110, 61)) engine.ingestPrice("HIUSDT", point, point.t);
    for (const point of ramp(100, 100.5, 61)) engine.ingestPrice("LOUSDT", point, point.t);
    const table = scoreCalibration(engine.getTracked());
    const hi = table.find((row) => row.bucket === "95-100")!;
    const lo = table.find((row) => row.bucket === "60-69")!;
    expect(hi.n).toBe(1);
    expect(lo.n).toBe(1);
    expect(hi.averageMfe ?? 0).toBeGreaterThan(lo.averageMfe ?? 0);
  });

  it("15 missed movers get a machine-readable reason", () => {
    const movers = detectMoverEvents({
      symbol: "GHOSTUSDT",
      points: ramp(100, 115, 61),
      now: T0 + 60 * 60_000,
    }).filter((row) => row.moveClass === 10);
    expect(movers.length).toBeGreaterThan(0);
    const miss = classifyMiss(movers[0], []);
    expect(miss.reason).toBe("NOT_DETECTED");
  });

  it("16 stale/gapped outcomes are excluded", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50, gapMs: 30_000 });
    engine.observeOpportunity([opp("GAPUSDT", { candidateId: "GAPUSDT:" + T0, firstDetectionPrice: 100 })], {
      now: T0,
      source: "replay",
    });
    engine.ingestPrice("GAPUSDT", { t: T0, price: 100 }, T0);
    engine.ingestPrice("GAPUSDT", { t: T0 + 5 * 60_000, price: 108 }, T0 + 5 * 60_000);
    const session = engine.getTracked()[0];
    expect(session.invalidReason).toBe("OUTCOME_DATA_INCOMPLETE");
    expect(liveCandidates(engine.getTracked()).length).toBe(0);
    expect(session.outcomes.find((row) => row.horizonMin === 5)?.quality).toBe("OUTCOME_DATA_INCOMPLETE");
  });

  it("17 synthetic source is excluded from live reports", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity([opp("SYNUSDT", { candidateId: "SYNUSDT:" + T0 })], { now: T0, source: "synthetic" });
    for (const point of ramp(1, 1.1, 61)) engine.ingestPrice("SYNUSDT", point, point.t);
    const report = getDailyEdgeReport({ rows: engine.getTracked(), movers: [] });
    expect(report.candidateCount).toBe(0);
    expect(getDailyEdgeReport({ rows: engine.getTracked(), movers: [], includeSynthetic: true }).candidateCount).toBe(1);
  });

  it("18 lookahead ticks after now are ignored", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity([opp("FUTUSDT", { candidateId: "FUTUSDT:" + T0, firstDetectionPrice: 100 })], {
      now: T0,
      source: "replay",
    });
    engine.ingestPrice("FUTUSDT", { t: T0 + 60 * 60_000, price: 150 }, T0 + 1_000);
    const m60 = engine.getTracked()[0].outcomes.find((row) => row.horizonMin === 60)!;
    expect(m60.mfePct == null || m60.mfePct < 5).toBe(true);
    engine.tickPrices(
      [snap("FUTUSDT", { lastPrice: 160, eventTime: T0 + 3_600_000, lastUpdateAt: T0 + 3_600_000 })],
      T0 + 1_000,
    );
    const after = engine.getTracked()[0].outcomes.find((row) => row.horizonMin === 60)!;
    expect(after.mfePct == null || after.mfePct < 5).toBe(true);
  });

  it("19 AI segmentation does not mutate stored outcomes", () => {
    const engine = new ShadowOutcomeEngine({ minTrackScore: 50 });
    engine.observeOpportunity([opp("AIUSDT", { candidateId: "AIUSDT:" + T0, firstDetectionPrice: 100 })], { now: T0 });
    for (const point of ramp(100, 106, 61)) engine.ingestPrice("AIUSDT", point, point.t);
    const before = engine.getTracked()[0].outcomes.find((row) => row.horizonMin === 60)!.mfePct;
    const grouped = aiValue(engine.getTracked());
    const after = engine.getTracked()[0].outcomes.find((row) => row.horizonMin === 60)!.mfePct;
    expect(after).toBe(before);
    expect(grouped.length).toBeGreaterThan(0);
  });

  it("20 shadow engine cannot reach order endpoints", () => {
    const engine = new ShadowOutcomeEngine();
    expect(SHADOW_OUTCOME_ORDERS_DISABLED).toBe(true);
    expect(engine.ordersDisabled).toBe(true);
    expect(() => engine.submitLiveOrder()).toThrow(/ORDERS_DISABLED/);
    const dir = path.join(process.cwd(), "src/server/shadow-outcome");
    for (const file of ["shadow-outcome-engine.ts", "analytics.ts", "reports.ts", "persist.ts", "index.ts"]) {
      const src = readFileSync(path.join(dir, file), "utf8");
      expect(src).not.toMatch(/placeOrder|createOrder|submitOrder|binance.*order/i);
    }
    expect(CANONICAL_CALL_CHAIN.some((row) => row.includes("shadow-outcome-engine"))).toBe(true);
    expect(SERVICE_RUNTIME_CLASS["shadow-outcome-engine"]).toBe("SHADOW_ONLY");
  });

  it("integration: opportunity → micro → shadow → MFE/recall", () => {
    const opportunity = new OpportunityEngine();
    const micro = new MicrostructureEngine();
    const shadow = new ShadowOutcomeEngine({ minTrackScore: 40 });
    const scan = opportunity.scan([
      snap("PUMPUSDT", {
        lastPrice: 100.8,
        eventTime: T0,
        lastUpdateAt: T0,
        change24h: 0.5,
        rolling: rolling({
          return1s: 0.12,
          return5s: 0.35,
          return15s: 0.5,
          return30s: 0.6,
          return1m: 0.8,
          return3m: 0.9,
          return5m: 1.0,
          return15m: 1.1,
          quoteVolumeDelta: 220_000,
        }),
      }),
      snap("BTCUSDT", { lastPrice: 60_000, eventTime: T0, lastUpdateAt: T0 }),
    ]);
    expect(scan.ranked.length).toBeGreaterThan(0);
    const now = T0;
    const trades = Array.from({ length: 16 }, (_, i) =>
      trade({ side: "BUY", notional: 900, price: 100.8 + i * 0.01, t: now - (16 - i) * 90, symbol: "PUMPUSDT" }),
    );
    const ranked = micro.evaluatePrepared(
      scan.ranked.slice(0, 1).map((row) => ({
        opportunity: row,
        trades,
        book: { ...book(), symbol: row.symbol },
        depth: {
          bids: [{ price: 100.7, quantity: 800 }, { price: 100.6, quantity: 1_200 }],
          asks: [{ price: 100.82, quantity: 80 }, { price: 100.9, quantity: 70 }],
        },
        bookHistory: [
          { t: now - 4_000, bestBid: 100.5, bestAsk: 100.8, bidQty: 400, askQty: 500, spreadBps: 30 },
          { t: now, bestBid: 100.78, bestAsk: 100.82, bidQty: 520, askQty: 90, spreadBps: 4 },
        ],
        intendedNotional: 50,
        now,
      })),
    );
    shadow.observeOpportunity(scan.ranked, { now, source: "replay" });
    shadow.observeMicro(ranked.ranked, { now, source: "replay" });
    const detected = shadow.getTracked()[0];
    expect(detected).toBeTruthy();
    const start = detected.snapshot.firstDetectionPrice;
    const tDetect = detected.snapshot.firstDetectedAt;
    for (let i = 1; i <= 60; i += 1) {
      const t = tDetect + i * 60_000;
      shadow.ingestPrice(detected.snapshot.symbol, { t, price: start * (1 + 0.002 * i) }, t);
    }
    const m60 = detected.outcomes.find((row) => row.horizonMin === 60)!;
    expect(m60.quality).toBe("OK");
    expect(m60.mfePct ?? 0).toBeGreaterThan(5);
    const movers = detectMoverEvents({
      symbol: detected.snapshot.symbol,
      points: shadow.getPricePoints(detected.snapshot.symbol),
      now: tDetect + 60 * 60_000,
    });
    expect(moverRecall(movers, shadow.getTracked(), 10).detected).toBeGreaterThanOrEqual(1);
    const report = getDailyEdgeReport({ rows: shadow.getTracked(), movers, includeSynthetic: false });
    expect(report.candidateCount).toBeGreaterThan(0);
    expect(report.precision.at5.n).toBeGreaterThan(0);
  });

  it("replay archetypes: vertical / slow / continuation / fake / rally / relative-strength", () => {
    const cases: Array<{ symbol: string; end: number; expectMfe: "high" | "low" }> = [
      { symbol: "VERTUSDT", end: 118, expectMfe: "high" },
      { symbol: "SLOWUSDT", end: 104, expectMfe: "low" },
      { symbol: "CONTUSDT", end: 109, expectMfe: "high" },
      { symbol: "FAKEUSDT", end: 100.2, expectMfe: "low" },
      { symbol: "RALLYUSDT", end: 107, expectMfe: "high" },
      { symbol: "RSUSDT", end: 108, expectMfe: "high" },
    ];
    const shadow = new ShadowOutcomeEngine({ minTrackScore: 50 });
    for (const row of cases) {
      shadow.observeOpportunity(
        [
          opp(row.symbol, {
            candidateId: `${row.symbol}:${T0}`,
            symbol: row.symbol,
            firstDetectionPrice: 100,
            score: 80,
            primaryLane: row.symbol === "CONTUSDT" ? "CONTINUATION" : "EARLY",
          }),
        ],
        { now: T0, source: "replay" },
      );
      const peak = row.symbol === "FAKEUSDT" ? 103.5 : row.end;
      const points =
        row.symbol === "FAKEUSDT"
          ? [...ramp(100, peak, 20), ...ramp(peak, row.end, 41, T0 + 19 * 60_000)]
          : ramp(100, row.end, 61);
      for (const point of points) shadow.ingestPrice(row.symbol, point, point.t);
    }
    for (const row of cases) {
      const mfe = shadow.getTracked().find((item) => item.snapshot.symbol === row.symbol)?.outcomes.find((item) => item.horizonMin === 60)?.mfePct ?? 0;
      if (row.expectMfe === "high") expect(mfe).toBeGreaterThan(3);
      else expect(mfe).toBeLessThan(5);
    }
  });
});
