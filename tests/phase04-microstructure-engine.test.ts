import { afterEach, describe, expect, it } from "vitest";
import type { MarketTradeEvent, BookTickerState } from "@/src/server/market-data/spine/events";
import type { OpportunityCandidate } from "@/src/server/opportunity/types";
import { computeMicroFeatures } from "@/src/server/microstructure/features";
import {
  buildMicroBreakdown,
  liquidityQualityScore,
  scoreMicro,
} from "@/src/server/microstructure/score";
import { parseAiAdvisory, compactAiContext } from "@/src/server/microstructure/ai-advisory";
import { combineFinalScore, tdiShadow } from "@/src/server/microstructure/final-ranker";
import {
  MicrostructureEngine,
  toMarketContext,
  resetMicrostructureEngineForTests,
} from "@/src/server/microstructure/microstructure-engine";
import { resetMarketDataDaemonForTests } from "@/src/server/market-data/spine/market-data-daemon";
import {
  countHotPathPublicMarketRestCalls,
  resetPublicMarketRestAudit,
} from "@/src/server/market-data/spine/rest-call-audit";

function opp(symbol = "AAAUSDT", extra: Partial<OpportunityCandidate> = {}): OpportunityCandidate {
  const now = Date.now();
  return {
    candidateId: `${symbol}:1`,
    symbol,
    primaryLane: "EARLY",
    secondaryEvidence: [],
    score: 91,
    laneScores: { EARLY: 91, STEADY: 70, MOMENTUM: 40, CONTINUATION: 20 },
    breakdown: {
      priceVelocity: 20,
      priceAcceleration: 24,
      volumeAcceleration: 18,
      relativeVolume: 14,
      relativeStrength: 10,
      breakout: 8,
      compressionExpansion: 6,
      consistency: 8,
      retracementQuality: 6,
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
    state: "HOT",
    firstDetectedAt: now - 2_000,
    firstDetectionPrice: 100,
    lastScoreAt: now,
    lastEvidenceAt: now,
    currentPrice: 101.3,
    scansWithoutEvidence: 0,
    deepSubscribed: true,
    ...extra,
  };
}

function trade(input: {
  side: "BUY" | "SELL";
  notional: number;
  price?: number;
  t?: number;
  symbol?: string;
}): MarketTradeEvent {
  const price = input.price ?? 100;
  const quantity = input.notional / price;
  return {
    type: "trade",
    symbol: input.symbol ?? "AAAUSDT",
    price,
    quantity,
    quoteNotional: input.notional,
    eventTime: input.t ?? Date.now(),
    tradeTime: input.t ?? Date.now(),
    receiveTime: input.t ?? Date.now(),
    buyerMaker: input.side === "SELL",
    takerSide: input.side,
    source: "memory",
  };
}

function burst(side: "BUY" | "SELL", count: number, notional: number, now = Date.now(), startPrice = 100) {
  return Array.from({ length: count }, (_, i) =>
    trade({
      side,
      notional,
      price: startPrice + (side === "BUY" ? i * 0.01 : -i * 0.01),
      t: now - (count - i) * 80,
    }),
  );
}

function book(spreadBps: number, bidQty = 400, askQty = 200): BookTickerState {
  const mid = 100;
  const half = mid * (spreadBps / 10_000) / 2;
  return {
    symbol: "AAAUSDT",
    bestBid: mid - half,
    bestBidQty: bidQty,
    bestAsk: mid + half,
    bestAskQty: askQty,
    spreadAbsolute: half * 2,
    spreadBps,
    eventTime: Date.now(),
    lastUpdateAt: Date.now(),
    stale: false,
  };
}

function feats(trades: MarketTradeEvent[], extra?: Partial<Parameters<typeof computeMicroFeatures>[0]>) {
  return computeMicroFeatures({
    opportunity: extra?.opportunity ?? opp(),
    trades,
    book: extra?.book ?? book(4, 500, 120),
    depth: extra?.depth ?? {
      bids: [{ price: 99.98, quantity: 800 }, { price: 99.9, quantity: 1_200 }],
      asks: [{ price: 100.02, quantity: 90 }, { price: 100.1, quantity: 70 }],
    },
    bookHistory: extra?.bookHistory ?? [
      { t: Date.now() - 4_000, bestBid: 99.9, bestAsk: 100.2, bidQty: 400, askQty: 600, spreadBps: 30 },
      { t: Date.now() - 2_000, bestBid: 99.95, bestAsk: 100.1, bidQty: 420, askQty: 300, spreadBps: 15 },
      { t: Date.now(), bestBid: 99.98, bestAsk: 100.02, bidQty: 500, askQty: 120, spreadBps: 4 },
    ],
    intendedNotional: 50,
    now: extra?.now ?? Date.now(),
  });
}

describe("phase 04 microstructure engine", () => {
  afterEach(() => {
    resetMicrostructureEngineForTests();
    resetMarketDataDaemonForTests().stop();
  });

  it("strong taker buy produces a positive micro score", () => {
    const features = feats(burst("BUY", 24, 1_200));
    const score = scoreMicro("EARLY", buildMicroBreakdown(features), features);
    expect(features.takerBuyRatio5s).toBeGreaterThan(0.7);
    expect(score).toBeGreaterThan(50);
  });

  it("strong taker sell does not raise LONG micro score", () => {
    const features = feats(burst("SELL", 24, 1_200));
    const score = scoreMicro("EARLY", buildMicroBreakdown(features), features);
    expect(features.flowImbalance5s).toBeLessThan(0);
    expect(score).toBeLessThanOrEqual(0);
  });

  it("flow imbalance keeps direction", () => {
    const buy = feats(burst("BUY", 16, 800));
    const sell = feats(burst("SELL", 16, 800));
    expect(buy.flowImbalance5s).toBeGreaterThan(0);
    expect(sell.flowImbalance5s).toBeLessThan(0);
    expect(buy.flowImbalance5s).not.toBe(sell.flowImbalance5s);
  });

  it("buy flow acceleration raises score", () => {
    const now = Date.now();
    const slow = [
      ...Array.from({ length: 8 }, (_, i) => trade({ side: "BUY", notional: 200, t: now - 14_000 + i * 400 })),
      ...Array.from({ length: 6 }, (_, i) => trade({ side: "BUY", notional: 220, t: now - 4_000 + i * 400 })),
    ];
    const fast = [
      ...Array.from({ length: 6 }, (_, i) => trade({ side: "BUY", notional: 180, t: now - 14_000 + i * 400 })),
      ...Array.from({ length: 10 }, (_, i) => trade({ side: "BUY", notional: 900, t: now - 4_000 + i * 200 })),
    ];
    const slowScore = scoreMicro("EARLY", buildMicroBreakdown(feats(slow)), feats(slow));
    const fastScore = scoreMicro("EARLY", buildMicroBreakdown(feats(fast)), feats(fast));
    expect(feats(fast).buyFlowAcceleration).toBeGreaterThan(feats(slow).buyFlowAcceleration);
    expect(fastScore).toBeGreaterThan(slowScore);
  });

  it("sell flow acceleration lowers LONG score", () => {
    const now = Date.now();
    const acceleratingSells = [
      ...Array.from({ length: 4 }, (_, i) => trade({ side: "SELL", notional: 150, t: now - 14_000 + i * 400 })),
      ...Array.from({ length: 12 }, (_, i) => trade({ side: "SELL", notional: 800, t: now - 3_000 + i * 120 })),
    ];
    const features = feats(acceleratingSells);
    expect(features.sellFlowAcceleration).toBeGreaterThan(0);
    expect(scoreMicro("EARLY", buildMicroBreakdown(features), features)).toBeLessThan(40);
  });

  it("trade-frequency acceleration is measured", () => {
    const now = Date.now();
    const features = feats([
      ...Array.from({ length: 4 }, (_, i) => trade({ side: "BUY", notional: 300, t: now - 12_000 + i * 1_000 })),
      ...Array.from({ length: 20 }, (_, i) => trade({ side: "BUY", notional: 280, t: now - 4_000 + i * 80 })),
    ]);
    expect(features.tradeRate5s).toBeGreaterThan(features.tradeRate15s);
    expect(features.tradeRateAcceleration).toBeGreaterThan(0);
  });

  it("tiny-trade spam does not produce a high score", () => {
    const now = Date.now();
    const spam = Array.from({ length: 80 }, (_, i) => trade({ side: "BUY", notional: 2, t: now - 4_000 + i * 40 }));
    const real = burst("BUY", 12, 1_400, now);
    const spamScore = scoreMicro("EARLY", buildMicroBreakdown(feats(spam)), feats(spam));
    const realScore = scoreMicro("EARLY", buildMicroBreakdown(feats(real)), feats(real));
    expect(spamScore).toBeLessThan(realScore);
  });

  it("large buy trades use a relative threshold", () => {
    const now = Date.now();
    const trades = [
      ...Array.from({ length: 20 }, (_, i) => trade({ side: "BUY", notional: 40, t: now - 8_000 + i * 200 })),
      trade({ side: "BUY", notional: 2_400, t: now - 1_000 }),
    ];
    const features = feats(trades);
    expect(features.largeBuyNotional).toBeGreaterThan(0);
    expect(features.largeBuyNotional).toBeGreaterThan(features.largeSellNotional);
  });

  it("tight spread raises quality", () => {
    const tight = liquidityQualityScore(feats(burst("BUY", 10, 400), { book: book(3, 600, 500) }));
    const wide = liquidityQualityScore(feats(burst("BUY", 10, 400), { book: book(160, 40, 40) }));
    expect(tight).toBeGreaterThan(wide);
  });

  it("wide spread lowers quality", () => {
    const features = feats(burst("BUY", 10, 400), { book: book(180, 30, 30) });
    expect(buildMicroBreakdown(features).spreadQuality).toBeLessThan(20);
  });

  it("positive depth imbalance is directional", () => {
    const features = feats(burst("BUY", 10, 500), {
      depth: {
        bids: [{ price: 99.99, quantity: 2_000 }],
        asks: [{ price: 100.01, quantity: 80 }],
      },
    });
    expect(features.depthImbalance10bps).toBeGreaterThan(0);
  });

  it("negative depth imbalance does not raise LONG score", () => {
    const pos = feats(burst("BUY", 8, 400), {
      depth: { bids: [{ price: 99.99, quantity: 2_000 }], asks: [{ price: 100.01, quantity: 50 }] },
    });
    const neg = feats(burst("BUY", 8, 400), {
      depth: { bids: [{ price: 99.99, quantity: 40 }], asks: [{ price: 100.01, quantity: 2_400 }] },
    });
    expect(scoreMicro("EARLY", buildMicroBreakdown(pos), pos)).toBeGreaterThan(
      scoreMicro("EARLY", buildMicroBreakdown(neg), neg),
    );
  });

  it("ask depletion is positive evidence", () => {
    const features = feats(burst("BUY", 12, 600), {
      bookHistory: [
        { t: Date.now() - 6_000, bestBid: 99.8, bestAsk: 100.2, bidQty: 300, askQty: 900, spreadBps: 40 },
        { t: Date.now() - 3_000, bestBid: 99.9, bestAsk: 100.1, bidQty: 320, askQty: 400, spreadBps: 20 },
        { t: Date.now(), bestBid: 99.98, bestAsk: 100.02, bidQty: 380, askQty: 90, spreadBps: 4 },
      ],
    });
    expect(features.askDepletionRate).toBeGreaterThan(0.2);
    expect(buildMicroBreakdown(features).askDepletion).toBeGreaterThan(0);
  });

  it("ask refill lowers continuation score", () => {
    const refill = feats(burst("BUY", 12, 500), {
      bookHistory: [
        { t: Date.now() - 6_000, bestBid: 99.9, bestAsk: 100.1, bidQty: 300, askQty: 80, spreadBps: 20 },
        { t: Date.now(), bestBid: 99.9, bestAsk: 100.1, bidQty: 280, askQty: 700, spreadBps: 20 },
      ],
    });
    const deplete = feats(burst("BUY", 12, 500), {
      bookHistory: [
        { t: Date.now() - 6_000, bestBid: 99.9, bestAsk: 100.1, bidQty: 300, askQty: 700, spreadBps: 20 },
        { t: Date.now(), bestBid: 99.9, bestAsk: 100.1, bidQty: 320, askQty: 70, spreadBps: 20 },
      ],
    });
    expect(scoreMicro("CONTINUATION", buildMicroBreakdown(refill), refill)).toBeLessThan(
      scoreMicro("CONTINUATION", buildMicroBreakdown(deplete), deplete),
    );
  });

  it("bid withdrawal produces a warning", () => {
    const features = feats(burst("BUY", 10, 400), {
      bookHistory: [
        { t: Date.now() - 5_000, bestBid: 99.9, bestAsk: 100.1, bidQty: 800, askQty: 200, spreadBps: 20 },
        { t: Date.now(), bestBid: 99.9, bestAsk: 100.1, bidQty: 80, askQty: 200, spreadBps: 20 },
      ],
    });
    expect(features.bidWithdrawal).toBeGreaterThan(0.4);
  });

  it("price up + flow down produces a divergence penalty", () => {
    const now = Date.now();
    const trades = [
      ...Array.from({ length: 12 }, (_, i) => trade({ side: "BUY", notional: 900, price: 100 + i * 0.02, t: now - 14_000 + i * 200 })),
      ...Array.from({ length: 3 }, (_, i) => trade({ side: "SELL", notional: 120, price: 101.4 + i * 0.02, t: now - 2_000 + i * 200 })),
    ];
    const features = feats(trades);
    expect(features.priceFlowDivergence).toBeGreaterThan(0);
    expect(buildMicroBreakdown(features).divergence).toBeLessThanOrEqual(0);
  });

  it("failed breakout is a penalty", () => {
    const now = Date.now();
    const trades = [
      ...Array.from({ length: 10 }, (_, i) => trade({ side: "BUY", notional: 400, price: 100 + i * 0.2, t: now - 20_000 + i * 400 })),
      ...Array.from({ length: 10 }, (_, i) => trade({ side: "SELL", notional: 500, price: 102 - i * 0.18, t: now - 4_000 + i * 200 })),
    ];
    const features = feats(trades, { opportunity: opp("AAAUSDT", { firstDetectionPrice: 100, currentPrice: 100.4 }) });
    expect(features.failedBreakout).toBeGreaterThan(0);
    expect(buildMicroBreakdown(features).breakoutAcceptance).toBeLessThan(
      buildMicroBreakdown(feats(burst("BUY", 16, 700, now, 100))).breakoutAcceptance,
    );
  });

  it("breakout acceptance raises score", () => {
    const now = Date.now();
    const accepted = burst("BUY", 20, 700, now, 100.0).map((row, i) => ({
      ...row,
      price: 100 + i * 0.08,
    }));
    const features = feats(accepted);
    expect(features.breakoutRetestQuality + features.postBreakoutFlow).toBeGreaterThan(0);
  });

  it("exhaustion lowers the final score", () => {
    const healthy = feats(burst("BUY", 16, 800));
    const exhausted = {
      ...healthy,
      microExhaustion: 0.9,
      failedBreakout: 0.6,
      priceFlowDivergence: 0.7,
    };
    const healthyFinal = combineFinalScore({
      opportunityScore: 90,
      microScore: scoreMicro("MOMENTUM", buildMicroBreakdown(healthy), healthy),
      liquidityScore: 80,
      aiModifier: 0,
    });
    const exhaustedFinal = combineFinalScore({
      opportunityScore: 90,
      microScore: scoreMicro("MOMENTUM", buildMicroBreakdown(exhausted), exhausted),
      liquidityScore: 80,
      aiModifier: 0,
    });
    expect(exhaustedFinal).toBeLessThan(healthyFinal);
  });

  it("AI timeout modifier is 0", () => {
    expect(parseAiAdvisory({ status: "TIMEOUT", decision: "BULLISH_CONTEXT", confidence: 99 }, 8).modifier).toBe(0);
  });

  it("AI NO_OPINION modifier is 0", () => {
    expect(parseAiAdvisory({ status: "READY", decision: "NO_OPINION", confidence: 90 }, 8).modifier).toBe(0);
  });

  it("AI negative opinion cannot hard-reject by itself", () => {
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2 }));
    const input = {
      opportunity: opp(),
      trades: burst("BUY", 20, 900),
      book: book(4, 600, 120),
      depth: { bids: [{ price: 99.98, quantity: 900 }], asks: [{ price: 100.02, quantity: 80 }] },
      bookHistory: [],
      intendedNotional: 50,
      ai: parseAiAdvisory({ status: "READY", decision: "CAUTION", confidence: 95 }, 8),
    };
    const row = engine.evaluatePrepared([input]).ranked[0];
    expect(row.ai.modifier).toBeLessThan(0);
    expect(row.hardReject).toBeNull();
    expect(row.state).not.toBe("HARD_REJECT");
  });

  it("TDI reject cannot hard-reject by itself", () => {
    const shadow = tdiShadow("REJECT_VETO", 88);
    expect(shadow.canReject).toBe(false);
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2 }));
    const row = engine.evaluatePrepared([
      {
        opportunity: opp(),
        trades: burst("BUY", 18, 800),
        book: book(5, 500, 140),
        depth: null,
        bookHistory: [],
        intendedNotional: 50,
        tdiDecision: "REJECT",
      },
    ]).ranked[0];
    expect(row.tdi.canReject).toBe(false);
    expect(row.hardReject).toBeNull();
  });

  it("stale micro data cannot become execution-ready", () => {
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2, staleMs: 200 }));
    const old = Date.now() - 5_000;
    const row = engine.evaluatePrepared([
      {
        opportunity: opp(),
        trades: burst("BUY", 12, 700, old),
        book: { ...book(4), lastUpdateAt: old },
        depth: null,
        bookHistory: [],
        intendedNotional: 50,
        now: Date.now(),
      },
    ]).ranked[0];
    expect(row.state).not.toBe("EXECUTION_READY");
    expect(row.reasonCodes).toContain("MICRO_DATA_STALE");
  });

  it("does not duplicate deep subscriptions for the same candidate", () => {
    const daemon = resetMarketDataDaemonForTests();
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2 }));
    const candidate = opp();
    engine.evaluate([candidate]);
    const first = daemon.telemetry().deepSubscriptions;
    engine.evaluate([candidate]);
    expect(daemon.telemetry().deepSubscriptions).toBe(first);
  });

  it("candidate expiration releases microstructure subscriptions", () => {
    const daemon = resetMarketDataDaemonForTests();
    const now = Date.now();
    daemon.ingest({ e: "aggTrade", E: now, s: "AAAUSDT", p: "100", q: "5", m: false, T: now, a: 1 }, now);
    daemon.ingest({ u: 1, s: "AAAUSDT", b: "99.98", B: "400", a: "100.02", A: "90" }, now);
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 1, staleMs: 60_000 }));
    engine.evaluate([opp()]);
    expect(daemon.telemetry().deepSubscriptions).toBeGreaterThan(0);
    engine.evaluate([]);
    expect(engine.getRanked()).toHaveLength(0);
  });

  it("rank hysteresis prevents 1-tick flip-flop", () => {
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2 }));
    const a = {
      opportunity: opp("AAAUSDT", { score: 90, candidateId: "AAAUSDT:1" }),
      trades: burst("BUY", 16, 800),
      book: book(4, 500, 100),
      depth: null,
      bookHistory: [],
      intendedNotional: 50,
    };
    const b = {
      opportunity: opp("BBBUSDT", { score: 89, candidateId: "BBBUSDT:1", symbol: "BBBUSDT" }),
      trades: burst("BUY", 15, 760),
      book: book(5, 480, 110),
      depth: null,
      bookHistory: [],
      intendedNotional: 50,
    };
    const first = engine.evaluatePrepared([a, b]).ranked;
    const leader = first[0].candidateId;
    const flipped = engine.evaluatePrepared([
      { ...a, opportunity: opp("AAAUSDT", { score: 89.4, candidateId: "AAAUSDT:1" }) },
      { ...b, opportunity: opp("BBBUSDT", { score: 90.1, candidateId: "BBBUSDT:1", symbol: "BBBUSDT" }) },
    ]).ranked;
    expect(flipped[0].candidateId).toBe(leader);
  });

  it("opportunity + micro scores combine deterministically", () => {
    const a = combineFinalScore({ opportunityScore: 91, microScore: 87, liquidityScore: 94, aiModifier: 2 });
    const b = combineFinalScore({ opportunityScore: 91, microScore: 87, liquidityScore: 94, aiModifier: 2 });
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(80);
  });

  it("signed scoring never uses abs to flip sell flow into a long bonus", () => {
    const sell = feats(burst("SELL", 20, 900));
    expect(sell.flowImbalance5s).toBeLessThan(0);
    expect(sell.netTakerFlow5s).toBeLessThan(0);
    expect(scoreMicro("EARLY", buildMicroBreakdown(sell), sell)).toBeLessThanOrEqual(0);
  });

  it("carries ticker 24h volume and change into AI context without substituting 60s flow", () => {
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2 }));
    const opportunity = opp();
    const row = engine.evaluatePrepared([{
      opportunity, trades: burst("BUY", 14, 700), book: book(4),
      depth: null, bookHistory: [], intendedNotional: 50,
    }]).ranked[0];
    const context = toMarketContext(row);
    expect(context.volume24h).toBe(opportunity.features.quoteVolume24h);
    expect(context.change24h).toBe(1.2);
    expect(context.metadata.quoteVolume60s).not.toBe(context.volume24h);
    expect(context.metadata.volume24hAvailable).toBe(true);
    const missing = toMarketContext({ ...row, quoteVolume24h: undefined });
    expect(missing.volume24h).toBe(0);
    expect(missing.metadata.volume24hAvailable).toBe(false);
  });

  it("deep analysis does not poll REST", () => {
    resetPublicMarketRestAudit();
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2 }));
    engine.evaluatePrepared([
      {
        opportunity: opp(),
        trades: burst("BUY", 14, 700),
        book: book(4),
        depth: null,
        bookHistory: [],
        intendedNotional: 50,
      },
    ]);
    expect(countHotPathPublicMarketRestCalls()).toBe(0);
  });

  it("integration: opportunity HOT → trades/book → micro confirm → rank, AI timeout does not stall", () => {
    const daemon = resetMarketDataDaemonForTests();
    const now = Date.now();
    for (let i = 0; i < 24; i += 1) {
      const ts = now - (24 - i) * 100;
      daemon.ingest(
        { e: "aggTrade", E: ts, s: "AAAUSDT", p: String(100 + i * 0.02), q: "8", m: false, T: ts, a: i + 1 },
        ts,
      );
      daemon.ingest({ u: i + 1, s: "AAAUSDT", b: "99.98", B: "400", a: "100.02", A: "90" }, ts);
    }
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 4 }));
    resetPublicMarketRestAudit();
    const deep = daemon.getDeepState("AAAUSDT");
    const result = engine.evaluatePrepared([
      {
        opportunity: opp(),
        trades: deep?.recentTrades ?? [],
        book: deep?.bookTicker ?? book(4),
        depth: daemon.getOrderBook("AAAUSDT"),
        bookHistory: [],
        intendedNotional: 50,
        ai: parseAiAdvisory({ status: "TIMEOUT" }, 8),
      },
    ]);
    expect(countHotPathPublicMarketRestCalls()).toBe(0);
    expect(result.ranked[0]?.ai.modifier).toBe(0);
    expect(result.ranked[0]?.candidateId).toBe("AAAUSDT:1");
    expect(["WARMING", "MICRO_CONFIRMED", "EXECUTION_READY"]).toContain(result.ranked[0]?.state);
  });

  it("failed-pump replay ranks below a healthy buy-flow mover", () => {
    const engine = resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 2 }));
    const now = Date.now();
    const healthy = burst("BUY", 20, 900, now, 100);
    const dump = [
      ...Array.from({ length: 8 }, (_, i) => trade({ side: "BUY", notional: 600, price: 100 + i * 0.4, t: now - 12_000 + i * 200 })),
      ...Array.from({ length: 16 }, (_, i) => trade({ side: "SELL", notional: 700, price: 103.2 - i * 0.2, t: now - 4_000 + i * 120 })),
    ];
    const ranked = engine.evaluatePrepared([
      { opportunity: opp("GOODUSDT", { symbol: "GOODUSDT", candidateId: "GOODUSDT:1", score: 88 }), trades: healthy, book: book(4, 700, 90), depth: null, bookHistory: [], intendedNotional: 50 },
      { opportunity: opp("DUMPUSDT", { symbol: "DUMPUSDT", candidateId: "DUMPUSDT:1", score: 92, primaryLane: "MOMENTUM" }), trades: dump, book: book(40, 40, 400), depth: null, bookHistory: [], intendedNotional: 50 },
    ]).ranked;
    expect(ranked[0].symbol).toBe("GOODUSDT");
    expect(ranked.find((row) => row.symbol === "DUMPUSDT")!.smoothedScore).toBeLessThan(ranked[0].smoothedScore);
  });

  it("AI context stays compact and does not include raw books", () => {
    const ctx = compactAiContext({
      symbol: "AAAUSDT",
      lane: "EARLY",
      opportunityScore: 91,
      microScore: 87,
      return5m: 1.3,
      takerBuyRatio5s: 0.76,
      spreadBps: 4,
      exhaustion: 0.1,
    });
    expect(JSON.stringify(ctx).length).toBeLessThan(400);
    expect("trades" in ctx).toBe(false);
  });
});
