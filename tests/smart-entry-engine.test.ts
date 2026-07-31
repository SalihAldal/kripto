import { describe, expect, it } from "vitest";
import { evaluateSmartEntryEngine } from "../src/server/execution/smart-entry-engine.service";
import type { ScannerCandidate } from "../src/types/scanner";
import type { AIConsensusResult } from "../src/types/ai";

function candidate(overrides?: Partial<ScannerCandidate["context"]>): ScannerCandidate {
  return {
    rank: 1,
    context: {
      symbol: "BTCTRY",
      lastPrice: 100,
      change24h: 1.6,
      volume24h: 6_000_000,
      spreadPercent: 0.08,
      volatilityPercent: 1.3,
      momentumPercent: 0.7,
      orderBookImbalance: 0.2,
      buyPressure: 0.56,
      shortCandleSignal: 1,
      fakeSpikeScore: 0.5,
      tradable: true,
      rejectReasons: [],
      metadata: {
        shortMomentumPercent: 0.24,
        shortFlowImbalance: 0.08,
      },
      ...overrides,
    },
    score: {
      symbol: "BTCTRY",
      score: 76,
      confidence: 82,
      status: "QUALIFIED",
      reasons: [],
      metrics: {
        momentum: 1,
        microMomentum: 1,
        volume: 1,
        spread: 1,
        volatility: 1,
        orderBook: 1,
        pressure: 1,
        microFlow: 1,
        velocity: 1,
        candle: 1,
        fakeSpikePenalty: 0,
        liquidityPenalty: 0,
      },
    },
  };
}

function consensus(overrides?: Partial<AIConsensusResult>): AIConsensusResult {
  return {
    finalDecision: "BUY",
    finalConfidence: 91,
    finalRiskScore: 30,
    score: 0.86,
    explanation: "ok",
    outputs: [],
    rejected: false,
    generatedAt: new Date().toISOString(),
    decisionPayload: {
      coin: "BTCTRY",
      entryPrice: 100,
      targetPrice: 103,
      stopPrice: 99,
      riskRewardRatio: 2.1,
      technicalReason: "x",
      sentimentReason: "y",
      riskAssessment: "z",
      confidenceScore: 90,
      openTrade: true,
      safeEntryPoint: 99.8,
      timeframeAnalysis: {
        higher: {
          d1: { direction: "BULLISH", strength: 78, slopePercent: 2.2 },
          h4: { direction: "BULLISH", strength: 74, slopePercent: 1.4 },
          trend: "BULLISH",
          confidence: 76,
        },
        mid: {
          h1: { direction: "BULLISH", strength: 71, slopePercent: 1.1 },
          structure: "TREND_CONTINUATION",
          momentumBias: "BULLISH",
        },
        lower: {
          m15: { direction: "BULLISH", strength: 68, slopePercent: 0.7 },
          m5: { direction: "BULLISH", strength: 64, slopePercent: 0.4 },
          entryQuality: "HIGH",
        },
        entry: {
          m15: { direction: "BULLISH", strength: 68, slopePercent: 0.7 },
          m5: { direction: "BULLISH", strength: 64, slopePercent: 0.4 },
        },
        trend: {
          h1: { direction: "BULLISH", strength: 71, slopePercent: 1.1 },
        },
        macro: {
          h4: { direction: "BULLISH", strength: 74, slopePercent: 1.4 },
          d1: { direction: "BULLISH", strength: 78, slopePercent: 2.2 },
        },
        dominantTrend: "BULLISH",
        alignmentScore: 82,
        trendAligned: true,
        entrySuitable: true,
        conflict: false,
        conflictingSignals: [],
        finalAlignmentSummary: "uyumlu",
        reason: "uyumlu",
      },
      liquidityIntel: {
        probableStopClusters: [],
        sweepDetected: true,
        fakeBreakoutRisk: 28,
        safeEntryTiming: "POST_SWEEP_CONFIRMATION",
        liquidityRiskScore: 22,
        trappedTradersScenario: "NONE",
        breakoutTrap: false,
        rangeLiquidityGrab: false,
        smartMoneyStyleSummary: "ok",
      },
      liquidityZones: [],
      riskyAreas: [],
    },
    ...overrides,
  };
}

describe("smart-entry-engine", () => {
  it("iyi setup için proceed=true döner", () => {
    const result = evaluateSmartEntryEngine({
      candidate: candidate(),
      ai: consensus(),
      side: "BUY",
      entryPrice: 99.85,
      takeProfitPercent: 3.2,
      stopLossPercent: 1.4,
    });
    expect(result.proceed).toBe(true);
    expect(result.confirmationStatus).toBe("CONFIRMED");
    expect(result.entryQualityScore).toBeGreaterThan(60);
  });

  it("geç breakout kovalamada reject eder", () => {
    const result = evaluateSmartEntryEngine({
      candidate: candidate(),
      ai: consensus(),
      side: "BUY",
      entryPrice: 101.2,
      takeProfitPercent: 2.4,
      stopLossPercent: 1.6,
    });
    expect(result.proceed).toBe(false);
    expect(result.confirmationStatus).toBe("REJECTED");
    expect(result.lateEntryRisk).toBeGreaterThan(55);
  });

  it("spread uygunsuzsa reject eder", () => {
    const result = evaluateSmartEntryEngine({
      candidate: candidate({ spreadPercent: 0.35 }),
      ai: consensus(),
      side: "BUY",
      entryPrice: 99.9,
      takeProfitPercent: 2.9,
      stopLossPercent: 1.3,
    });
    expect(result.proceed).toBe(false);
    expect(result.reasons.join(" ")).toContain("Spread uygunsuz");
  });
});
