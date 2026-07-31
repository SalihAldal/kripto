import { describe, expect, it } from "vitest";
import { evaluateSignalQualityGate } from "../src/server/execution/signal-quality-gate.service";
import type { AIConsensusResult } from "../src/types/ai";
import type { ScannerCandidate } from "../src/types/scanner";

function candidate(): ScannerCandidate {
  return {
    rank: 1,
    context: {
      symbol: "BTCTRY",
      lastPrice: 100,
      change24h: 2.4,
      volume24h: 8_500_000,
      spreadPercent: 0.08,
      volatilityPercent: 1.5,
      momentumPercent: 0.9,
      orderBookImbalance: 0.21,
      buyPressure: 0.6,
      shortCandleSignal: 2,
      fakeSpikeScore: 0.4,
      tradable: true,
      rejectReasons: [],
      metadata: {
        shortMomentumPercent: 0.32,
        shortFlowImbalance: 0.12,
        tradeVelocity: 0.5,
      },
    },
    score: {
      symbol: "BTCTRY",
      score: 78,
      confidence: 84,
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
    finalConfidence: 90,
    finalRiskScore: 28,
    score: 0.88,
    explanation: "ok",
    outputs: [],
    rejected: false,
    generatedAt: new Date().toISOString(),
    roleScores: [
      { role: "AI-1_TECHNICAL", score: 76, decision: "BUY", confidence: 92, rationale: ["x"] },
      { role: "AI-2_SENTIMENT", score: 68, decision: "BUY", confidence: 88, rationale: ["y"] },
      { role: "AI-3_RISK", score: 72, decision: "BUY", confidence: 80, rationale: ["z"], veto: false },
    ],
    decisionPayload: {
      coin: "BTCTRY",
      entryPrice: 100,
      targetPrice: 102,
      stopPrice: 99,
      riskRewardRatio: 2,
      technicalReason: "x",
      sentimentReason: "y",
      riskAssessment: "z",
      confidenceScore: 90,
      openTrade: true,
      timeframeAnalysis: {
        entry: {
          m1: { direction: "BULLISH", strength: 62, slopePercent: 0.3 },
          m5: { direction: "BULLISH", strength: 66, slopePercent: 0.5 },
        },
        trend: {
          m15: { direction: "BULLISH", strength: 70, slopePercent: 1.1 },
          h1: { direction: "BULLISH", strength: 74, slopePercent: 2.1 },
        },
        macro: {
          h4: { direction: "BULLISH", strength: 76, slopePercent: 3.4 },
          d1: { direction: "BULLISH", strength: 82, slopePercent: 5.2 },
        },
        dominantTrend: "BULLISH",
        trendAligned: true,
        entrySuitable: true,
        conflict: false,
        reason: "MTF uyumlu",
      },
    },
    ...overrides,
  };
}

describe("signal-quality-gate", () => {
  it("güçlü setup için geçer", () => {
    const result = evaluateSignalQualityGate({
      candidate: candidate(),
      ai: consensus(),
    });
    expect(result.ok).toBe(true);
    expect(result.qualityScore).toBeGreaterThan(57);
    expect(result.weightedTotal).toBe(result.qualityScore);
    expect(result.decision === "APPROVE" || result.decision === "CAUTION").toBe(true);
    expect(result.scoreBreakdown.technicalSetupQuality).toBeGreaterThan(0);
  });

  it("kalitesiz setup için reject eder", () => {
    const bad = candidate();
    bad.context.volume24h = 20_000;
    bad.context.spreadPercent = 0.5;
    bad.context.fakeSpikeScore = 3.2;
    bad.context.metadata.shortFlowImbalance = 0.01;
    const result = evaluateSignalQualityGate({
      candidate: bad,
      ai: consensus({
        finalRiskScore: 89,
        roleScores: [
          { role: "AI-1_TECHNICAL", score: 45, decision: "HOLD", confidence: 52, rationale: ["weak"] },
          { role: "AI-2_SENTIMENT", score: 42, decision: "NO_TRADE", confidence: 44, rationale: ["weak"] },
          { role: "AI-3_RISK", score: 24, decision: "NO_TRADE", confidence: 18, rationale: ["veto"], veto: true },
        ],
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.decision).toBe("REJECT");
    expect(result.confidenceTier).toBe("REJECT");
    expect(result.whyRejected.length).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(2);
  });
});
