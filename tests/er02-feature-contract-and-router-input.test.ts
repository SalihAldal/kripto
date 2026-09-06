import { describe, expect, it } from "vitest";
import type { SymbolMarketSnapshot } from "@/src/server/market-data/spine/events";
import { OpportunityEngine, resetOpportunityEngineForTests } from "@/src/server/opportunity/opportunity-engine";
import { MicrostructureEngine, resetMicrostructureEngineForTests } from "@/src/server/microstructure/microstructure-engine";
import { buildFeatureContractSnapshot } from "@/src/server/execution/er02-feature-contract";
import { evaluateCanonicalRegime, routeStrategies } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { resolveTerminalEvidence } from "@/src/server/forensics/er01-telemetry-verdict";
import { countHotPathPublicMarketRestCalls, resetPublicMarketRestAudit } from "@/src/server/market-data/spine/rest-call-audit";
import type { AIConsensusResult } from "@/src/types/ai";

function snapshot(symbol: string, price: number, change24h = 1.2): SymbolMarketSnapshot {
  const now = Date.now();
  return {
    symbol,
    lastPrice: price,
    previousPrice: price * 0.999,
    openPrice: price * 0.99,
    change24h,
    high24h: price * 1.03,
    low24h: price * 0.96,
    quoteVolume24h: 9_000_000,
    baseVolume24h: 120_000,
    eventTime: now,
    localReceiveTime: now,
    lastUpdateAt: now,
    stale: false,
    rolling: {
      return1s: 0.04,
      return5s: 0.15,
      return15s: 0.32,
      return30s: 0.5,
      return1m: 0.7,
      return3m: 1.1,
      return5m: 1.7,
      return15m: 2.3,
      volumeDelta: 50_000,
      quoteVolumeDelta: 340_000,
    },
  };
}

function trades(now = Date.now()) {
  return Array.from({ length: 24 }, (_, i) => ({
    type: "trade" as const,
    symbol: "AAAUSDT",
    price: 100 + i * 0.02,
    quantity: 4,
    quoteNotional: (100 + i * 0.02) * 4,
    eventTime: now - (24 - i) * 200,
    tradeTime: now - (24 - i) * 200,
    receiveTime: now - (24 - i) * 200,
    buyerMaker: false,
    takerSide: "BUY" as const,
    source: "memory" as const,
  }));
}

function buildAi(overrides?: Partial<AIConsensusResult>): AIConsensusResult {
  return {
    finalDecision: "BUY",
    finalConfidence: 82,
    finalRiskScore: 35,
    finalConsensusDecision: "BUY",
    explanation: "fixture",
    score: 85,
    analysisScorecard: {
      symbol: "AAAUSDT",
      currentPrice: 100,
      direction: "BUY",
      confidenceScore: 80,
      expectedMovePercent: 1.4,
      expectedMoveRange: { min: 0.8, max: 2.0 },
      targetSellPercent: 1.5,
      initialStopPercent: 0.6,
      trailingStartPercent: 0.8,
      trailingGapPercent: 0.3,
      riskLevel: "MEDIUM",
      reasons: ["fixture"],
      invalidationReason: null,
      timeHorizonMinutes: 20,
    },
    ...overrides,
  } as AIConsensusResult;
}

function produceContext() {
  resetOpportunityEngineForTests(new OpportunityEngine());
  resetMicrostructureEngineForTests(new MicrostructureEngine({ warmupMs: 0, warmupTrades: 1 }));
  const opportunity = new OpportunityEngine().scan([snapshot("AAAUSDT", 100), snapshot("BTCUSDT", 60_000, 0.4)]);
  const candidate = opportunity.ranked[0];
  if (!candidate) throw new Error("fixture candidate missing");
  const micro = new MicrostructureEngine({ warmupMs: 0, warmupTrades: 1 });
  const result = micro.evaluatePrepared([
    {
      opportunity: candidate,
      trades: trades(),
      book: {
        symbol: "AAAUSDT",
        bestBid: 99.95,
        bestBidQty: 500,
        bestAsk: 100.05,
        bestAskQty: 420,
        spreadAbsolute: 0.1,
        spreadBps: 10,
        eventTime: Date.now(),
        lastUpdateAt: Date.now(),
        stale: false,
      },
      depth: {
        bids: [{ price: 99.95, quantity: 900 }],
        asks: [{ price: 100.05, quantity: 800 }],
      },
      bookHistory: [
        { t: Date.now() - 2_000, bestBid: 99.9, bestAsk: 100.1, bidQty: 450, askQty: 500, spreadBps: 20 },
        { t: Date.now(), bestBid: 99.95, bestAsk: 100.05, bidQty: 500, askQty: 420, spreadBps: 10 },
      ],
      intendedNotional: 150,
      now: Date.now(),
    },
  ]);
  expect(result.ranked.length).toBeGreaterThan(0);
  const scanner = micro.toScannerCandidates()[0];
  if (!scanner) throw new Error("scanner candidate missing");
  return scanner.context;
}

describe("ER02 feature contract and router adapter", () => {
  it("1 liquidity normalization 40 and 80 stay separable", () => {
    const context = produceContext();
    const a = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, liquidityScore: 40 } }, ai: buildAi() });
    const b = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, liquidityScore: 80 } }, ai: buildAi() });
    expect(a.strategyInput.liquidityScore).toBeCloseTo(0.4, 6);
    expect(b.strategyInput.liquidityScore).toBeCloseTo(0.8, 6);
    expect(b.strategyInput.liquidityScore).toBeGreaterThan(a.strategyInput.liquidityScore);
  });

  it("2 spread percent 0.1 maps to 10 bps once", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context: { ...context, spreadPercent: 0.1 }, ai: buildAi() });
    expect(out.strategyInput.spreadBps).toBe(10);
  });

  it("3 missing expected move does not fallback to ai score", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, expectedMovePercent: null } },
      ai: undefined,
    });
    expect(out.snapshot.expectedMove.value).toBeNull();
    expect(out.snapshot.missingFeatures).toContain("expectedMovePercent");
  });

  it("4 explicit zero is different than missing", () => {
    const context = produceContext();
    const zero = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, tradeVelocity: 0 } }, ai: buildAi() });
    const missing = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, tradeVelocity: null } }, ai: buildAi() });
    expect(zero.snapshot.features.velocity.value).toBe(0);
    expect(zero.snapshot.features.velocity.quality).toBe("VALID");
    expect(missing.snapshot.features.velocity.quality).toBe("MISSING");
  });

  it("5 NaN Infinity values are invalid", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, rangeScore: Number.NaN, flowRecovery: Number.POSITIVE_INFINITY } },
      ai: buildAi(),
    });
    expect(out.snapshot.invalidFeatures).toContain("rangeScore");
    expect(out.snapshot.invalidFeatures).toContain("flowRecovery");
  });

  it("6 pumpRisk is not used as pumpStrength", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, pumpRisk: 95, metadata: { ...context.metadata, pumpScore: 0.12 } },
      ai: buildAi(),
    });
    expect(out.regimeInput.pumpScore).toBeCloseTo(0.12, 6);
  });

  it("7 volatility uses explicit ratio field", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, volatilityPercent: 12, metadata: { ...context.metadata, volatilityRatio: 0.18 } },
      ai: buildAi(),
    });
    expect(out.regimeInput.volatility).toBe(0.18);
  });

  it("8 missing timestamp is not fresh", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, marketDataTimestamp: null } }, ai: buildAi() });
    expect(out.snapshot.marketEventAt).toBeNull();
    expect(out.snapshot.staleFeatures).toContain("marketEventAt");
  });

  it("9 stale boundary deterministic", () => {
    const context = produceContext();
    const old = new Date(Date.now() - 180_000).toISOString();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, marketDataTimestamp: old } },
      ai: buildAi(),
      staleAfterMs: 120_000,
    });
    expect(out.snapshot.features.velocity.quality).toBe("STALE");
  });

  it("10 future timestamp becomes invalid", () => {
    const context = produceContext();
    const future = new Date(Date.now() + 20_000).toISOString();
    const out = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, marketDataTimestamp: future } }, ai: buildAi() });
    expect(out.snapshot.features.velocity.quality).toBe("INVALID");
  });

  it("11 replay source is preserved", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, replayRunId: "r1" } }, ai: buildAi() });
    expect(out.snapshot.sourceType).toBe("RECORDED_REPLAY");
  });

  it("12 synthetic source is preserved", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, syntheticMarketData: true } }, ai: buildAi() });
    expect(out.snapshot.sourceType).toBe("SYNTHETIC_FIXTURE");
  });

  it("13 candidate symbol venue identity is preserved", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context, ai: buildAi() });
    expect(out.snapshot.candidateId).toBe(String(context.metadata.opportunityCandidateId));
    expect(out.snapshot.symbol).toBe(context.symbol);
  });

  it("14 metadata mutation does not mutate previous snapshot", () => {
    const context = produceContext();
    const first = buildFeatureContractSnapshot({ context, ai: buildAi() });
    (context.metadata as Record<string, unknown>).tradeVelocity = 999;
    expect(first.snapshot.features.velocity.value).not.toBe(999);
  });

  it("15 EARLY with missing acceleration is not eligible", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, priceAcceleration: null } }, ai: buildAi() });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    const early = routed.evaluations.find((x) => x.strategyId === "EARLY_ACCELERATION");
    expect(early?.verdict).toBe("WAIT");
  });

  it("16 missing breakout does not force EARLY wait", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, breakoutHeld: null } }, ai: buildAi() });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    const early = routed.evaluations.find((x) => x.strategyId === "EARLY_ACCELERATION");
    expect(early?.missingFeatures).not.toContain("breakoutHeld");
  });

  it("17 stale common data blocks all strategies", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, marketDataTimestamp: new Date(Date.now() - 300_000).toISOString() } },
      ai: buildAi(),
      staleAfterMs: 120_000,
    });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    expect(routed.evaluations.every((x) => x.verdict !== "ELIGIBLE")).toBe(true);
  });

  it("18 valid producer fixture yields at least one eligible strategy", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          expectedMovePercent: 1.8,
          expectedSlippageBps: 6,
          takerFeePercent: 0.1,
          strategyProfitBuffer: 0.12,
          regimeTransitionProbability: 0.2,
          regimeChaosProbability: 0.1,
          marketDataTimestamp: new Date().toISOString(),
        },
      },
      ai: buildAi(),
    });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    expect(routed.evaluations.some((x) => x.verdict === "ELIGIBLE")).toBe(true);
  });

  it("19 weak producer fixture yields ineligible", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          tradeVelocity: 0,
          priceAcceleration: -0.4,
          volumeAcceleration: -0.5,
          expectedMovePercent: 0.05,
          expectedSlippageBps: 6,
          takerFeePercent: 0.1,
          strategyProfitBuffer: 0.12,
          regimeTransitionProbability: 0.2,
          regimeChaosProbability: 0.1,
          marketDataTimestamp: new Date().toISOString(),
          pumpScore: 0.02,
        },
      },
      ai: buildAi(),
    });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    expect(routed.evaluations.some((x) => x.verdict === "INELIGIBLE")).toBe(true);
  });

  it("20 missing-data and zero-value produce different reasons", () => {
    const context = produceContext();
    const baseMeta = {
      ...context.metadata,
      expectedMovePercent: 1.8,
      expectedSlippageBps: 6,
      takerFeePercent: 0.1,
      strategyProfitBuffer: 0.12,
      regimeTransitionProbability: 0.2,
      regimeChaosProbability: 0.1,
      marketDataTimestamp: new Date().toISOString(),
    };
    const zero = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...baseMeta, tradeVelocity: 0 } }, ai: buildAi() });
    const missing = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...baseMeta, tradeVelocity: null } }, ai: buildAi() });
    const z = routeStrategies(zero.strategyInput, evaluateCanonicalRegime(zero.regimeInput));
    const m = routeStrategies(missing.strategyInput, evaluateCanonicalRegime(missing.regimeInput));
    expect(z.evaluations[0]?.reasons).not.toContain("MISSING_FEATURES");
    expect(m.evaluations[0]?.reasons).toContain("MISSING_FEATURES");
  });

  it("21 adapter blocks scalar-only early setup without producer context", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context, ai: buildAi() });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    const early = routed.evaluations.find((x) => x.strategyId === "EARLY_ACCELERATION");
    expect(early?.setupQuality).toBe(0);
    expect(early?.verdict).not.toBe("ELIGIBLE");
  });

  it("22 missing range no longer creates fake range eligibility", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, rangeScore: null, distanceFromMean: null, flowRecovery: null } },
      ai: buildAi(),
    });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    expect(routed.evaluations.find((x) => x.strategyId === "RANGE_MEAN_REVERSION")?.verdict).toBe("WAIT");
  });

  it("23 unknown expected move keeps cost viability unresolved", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, expectedMovePercent: null } }, ai: buildAi() });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    expect(routed.evaluations.some((x) => x.reasons.includes("MISSING_FEATURES"))).toBe(true);
  });

  it("24 missing fee/slippage is not auto zero-cost", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, expectedSlippageBps: null, takerFeePercent: null } },
      ai: buildAi(),
    });
    expect(out.snapshot.missingFeatures).toContain("entrySlippage");
    expect(out.snapshot.missingFeatures).toContain("entryFee");
  });

  it("25 measured and unknown cost source is explicit", () => {
    const context = produceContext();
    const measured = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, expectedSlippageBps: 8, takerFeePercent: 0.1 } }, ai: buildAi() });
    const unknown = buildFeatureContractSnapshot({ context: { ...context, metadata: { ...context.metadata, expectedSlippageBps: null, takerFeePercent: null } }, ai: buildAi() });
    expect(measured.snapshot.costs.source).toBe("MEASURED");
    expect(unknown.snapshot.costs.source).toBe("UNKNOWN");
  });

  it("26 horizon mismatch is visible invalid blocker", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, strategyHorizonMinutes: 2 } },
      ai: buildAi({ analysisScorecard: { ...buildAi().analysisScorecard, timeHorizonMinutes: 60 } as never }),
    });
    expect(out.snapshot.invalidFeatures).toContain("expectedMovePercent");
  });

  it("27 future outcome fields never feed expected move", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: { ...context, metadata: { ...context.metadata, realizedMfePercent: 9.9, expectedMovePercent: null } },
      ai: undefined,
    });
    expect(out.snapshot.expectedMove.value).toBeNull();
  });

  it("28 positive fixture validates at router level without submit", () => {
    const context = produceContext();
    const out = buildFeatureContractSnapshot({
      context: {
        ...context,
        metadata: {
          ...context.metadata,
          expectedMovePercent: 1.8,
          expectedSlippageBps: 6,
          takerFeePercent: 0.1,
          strategyProfitBuffer: 0.12,
          regimeTransitionProbability: 0.2,
          regimeChaosProbability: 0.1,
          marketDataTimestamp: new Date().toISOString(),
        },
      },
      ai: buildAi(),
    });
    const routed = routeStrategies(out.strategyInput, evaluateCanonicalRegime(out.regimeInput));
    expect(routed.preferredStrategy).not.toBeNull();
  });

  it("29 producer-router test path does not call exchange REST", () => {
    resetPublicMarketRestAudit();
    void produceContext();
    expect(countHotPathPublicMarketRestCalls()).toBe(0);
  });

  it("30 ER01 terminal contract remains compatible", () => {
    const out = resolveTerminalEvidence({
      structured: { decision: "WAIT", reasonCode: "INSUFFICIENT_DATA", secondaryReasonCodes: [], source: "CANONICAL" },
      legacyReason: "WAIT:INSUFFICIENT_DATA",
      runState: "tur_tamamlandi",
      hasCandidate: true,
      openedPosition: false,
      submittedOrder: false,
      fillCount: 0,
      executionFailed: false,
    });
    expect(out.decision).toBe("WAIT");
    expect(out.evidenceStatus).toBe("OBSERVED");
  });
});
