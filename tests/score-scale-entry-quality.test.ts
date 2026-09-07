import { describe, expect, it } from "vitest";
import { resolveExecutionConfidenceScore } from "@/src/server/execution/canonical-handoff.service";
import { shouldRejectHighRiskLowConfidenceEntry } from "@/src/server/execution/profit-thresholds";
import type { ScannerCandidate } from "@/src/types/scanner";

const scannerCandidate = (scannerConfidence: number): ScannerCandidate => ({
  rank: 1,
  context: {
    symbol: "ZROUSDT",
    lastPrice: 1,
    change24h: 0,
    volume24h: 1_000_000,
    volumeSpikePercent: 0,
    spreadPercent: 0.02,
    volatilityPercent: 0.3,
    momentumPercent: 0.2,
    orderBookImbalance: 0,
    buyPressure: 0,
    shortCandleSignal: 0,
    fakeSpikeScore: 0,
    pumpIntensity: 0,
    pumpRisk: 0,
    tradable: true,
    rejectReasons: [],
    metadata: {
      opportunityCandidateId: "cand-zro",
      canonicalHandoff: {
        handoffKind: "canonical_opportunity",
        candidateId: "cand-zro",
        symbol: "ZROUSDT",
        venue: "BINANCE_GLOBAL",
        selectedAt: new Date().toISOString(),
        recordUpdatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        aiConsensusStatus: "ready",
      },
    },
  },
  score: {
    symbol: "ZROUSDT",
    score: 70,
    confidence: scannerConfidence,
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
      pumpBoost: 0,
      pumpRiskPenalty: 0,
    },
  },
});

describe("score scale / entry-quality contract", () => {
  it("uses scanner confidence fallback when AI finalConfidence is 0 but scorecard empty", () => {
    const selected = scannerCandidate(78);
    const confidence = resolveExecutionConfidenceScore({
      selected,
      ai: {
        finalDecision: "BUY",
        finalConfidence: 0,
        finalRiskScore: 100,
        score: 0,
        explanation: "x",
        outputs: [],
        rejected: false,
        generatedAt: new Date().toISOString(),
        analysisScorecard: {
          symbol: "ZROUSDT",
          currentPrice: 1,
          direction: "BUY",
          confidenceScore: 0,
          expectedMovePercent: 0,
          expectedMoveRange: { min: 0, max: 0 },
          targetSellPercent: 0,
          initialStopPercent: 0,
          trailingStartPercent: 0,
          trailingGapPercent: 0,
          riskLevel: "HIGH",
          reasons: [],
          invalidationReason: null,
          timeHorizonMinutes: 10,
        },
      },
      learningLane: false,
    });
    expect(confidence).toBe(78);
    const gate = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: confidence,
      aiRiskScore: 100,
    });
    expect(gate.reject).toBe(true);
    expect(gate.reason).toContain("ENTRY_QUALITY:AI_RISK_ELEVATED_LOW_CONFIDENCE");
    expect(gate.reason).not.toContain("0%");
  });

  it("documents 0-100 scale for trade quality policy", () => {
    const allow = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: 84, aiRiskScore: 78 });
    const reject = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: 77, aiRiskScore: 78 });
    expect(allow.reject).toBe(false);
    expect(reject.reject).toBe(true);
  });
});
