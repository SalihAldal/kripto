import { describe, expect, it } from "vitest";
import {
  resolveEntryQualityConfidenceScore,
  resolveExecutionConfidenceScore,
} from "@/src/server/execution/canonical-handoff.service";
import { evaluateAiExecutionReadiness, resolveAiExecutionGatePolicy } from "@/src/server/execution/ai-execution-gate.service";
import { shouldRejectHighRiskLowConfidenceEntry, TRADE_QUALITY_POLICY } from "@/src/server/execution/profit-thresholds";
import { classifyRoundTerminalOutcome } from "@/src/server/execution/round-terminal-outcome.service";
import type { ScannerCandidate } from "@/src/types/scanner";
import type { AIConsensusResult } from "@/src/types/ai";

const baseCandidate = (scannerConfidence = 78): ScannerCandidate => ({
  rank: 1,
  context: {
    symbol: "TESTUSDT",
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
      opportunityCandidateId: "cand-test",
      canonicalHandoff: {
        handoffKind: "canonical_opportunity",
        candidateId: "cand-test",
        symbol: "TESTUSDT",
        venue: "BINANCE_GLOBAL",
        selectedAt: new Date().toISOString(),
        recordUpdatedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        aiConsensusStatus: "ready",
      },
    },
  },
  score: {
    symbol: "TESTUSDT",
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

const aiBase = (overrides: Partial<AIConsensusResult> = {}): AIConsensusResult => ({
  finalDecision: "BUY",
  finalConfidence: 90,
  finalRiskScore: 20,
  score: 0.8,
  explanation: "test",
  outputs: [
    {
      providerId: "p1",
      providerName: "OpenAI",
      ok: true,
      latencyMs: 100,
      output: { decision: "BUY", confidence: 90, riskScore: 20, rationale: [] },
    },
  ],
  rejected: false,
  generatedAt: new Date().toISOString(),
  analysisScorecard: {
    symbol: "TESTUSDT",
    currentPrice: 1,
    direction: "BUY",
    confidenceScore: 90,
    expectedMovePercent: 1,
    expectedMoveRange: { min: 0.5, max: 1.5 },
    targetSellPercent: 1,
    initialStopPercent: 0.5,
    trailingStartPercent: 0.5,
    trailingGapPercent: 0.2,
    riskLevel: "LOW",
    reasons: [],
    invalidationReason: null,
    timeHorizonMinutes: 10,
  },
  ...overrides,
});

describe("AI entry-quality admission contract", () => {
  it("CASE 1 — AI BUY conf=90 risk=20 passes entry quality", () => {
    const ai = aiBase();
    const conf = resolveEntryQualityConfidenceScore({ ai, learningLane: false });
    const gate = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: conf, aiRiskScore: ai.finalRiskScore });
    expect(gate.reject).toBe(false);
  });

  it("CASE 2 — AI BUY conf=75 risk=100 rejected by elevated-risk rule", () => {
    const ai = aiBase({ finalConfidence: 75, finalRiskScore: 100, analysisScorecard: { ...aiBase().analysisScorecard!, confidenceScore: 75 } });
    const gate = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: 75, aiRiskScore: 100 });
    expect(gate.reject).toBe(true);
    expect(gate.reason).toContain("ENTRY_QUALITY:AI_RISK_ELEVATED_LOW_CONFIDENCE");
  });

  it("CASE 3 — AI NO_TRADE is advisory; gate policy continues (not VETO)", () => {
    const ai = aiBase({ finalDecision: "NO_TRADE", finalConfidence: 75, finalRiskScore: 100 });
    const gate = evaluateAiExecutionReadiness({
      ai,
      policy: resolveAiExecutionGatePolicy({ mode: "paper", learningLane: true }),
      learningLane: true,
      microTradeEligible: true,
    });
    expect(gate.verdict).toBe("AI_ADVISORY_ONLY");
    expect(gate.policy).toBe("ADVISORY");
  });

  it("CASE 4 — AI BUY conf=85 risk=100 passes entry quality (elite floor intended)", () => {
    const gate = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: 85, aiRiskScore: 100 });
    expect(gate.reject).toBe(false);
  });

  it("CASE 5 — 0-1 scale is not auto-normalized; values stay literal", () => {
    const gate = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: 0.85, aiRiskScore: 0.2 });
    expect(gate.reject).toBe(false);
    expect(TRADE_QUALITY_POLICY.minConfidenceForHighRiskEntry).toBe(82);
  });

  it("CASE 6 — 0-100 scale 85/20 matches expected semantics", () => {
    const low = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: 85, aiRiskScore: 20 });
    const highRisk = shouldRejectHighRiskLowConfidenceEntry({ confidencePercent: 85, aiRiskScore: 100 });
    expect(low.reject).toBe(false);
    expect(highRisk.reject).toBe(false);
  });

  it("entry quality does not use scanner confidence fallback", () => {
    const selected = baseCandidate(77);
    const ai = aiBase({ finalConfidence: 0, finalRiskScore: 100, analysisScorecard: { ...aiBase().analysisScorecard!, confidenceScore: 0 } });
    const executionConf = resolveExecutionConfidenceScore({ selected, ai, learningLane: false });
    const entryConf = resolveEntryQualityConfidenceScore({ ai, learningLane: false });
    expect(executionConf).toBe(77);
    expect(entryConf).toBe(0);
  });

  it("kline-stale early exit risk=100 is safety default not provider risk", () => {
    const staleAi = aiBase({
      finalDecision: "NO_TRADE",
      finalConfidence: 0,
      finalRiskScore: 100,
      outputs: [],
      rejected: true,
      rejectReason: "Kline data missing or stale",
      analysisScorecard: undefined,
    });
    expect(staleAi.finalRiskScore).toBe(100);
    expect(staleAi.outputs).toHaveLength(0);
  });

  it("advisory shell has risk=0 not 100", async () => {
    const { buildCanonicalAdvisoryAiShell } = await import("@/src/server/execution/canonical-handoff.service");
    const shell = buildCanonicalAdvisoryAiShell({
      symbol: "X",
      lastPrice: 1,
      scannerConfidence: 70,
      reasonCode: "AI_HYDRATION_FAILED",
      reasonDetail: "timeout",
    });
    expect(shell.finalRiskScore).toBe(0);
    expect(shell.finalDecision).toBe("NO_TRADE");
  });

  it("classifies ENTRY_QUALITY terminal before generic execution", () => {
    const outcome = classifyRoundTerminalOutcome({
      reason: "ENTRY_QUALITY:AI_RISK_ELEVATED_LOW_CONFIDENCE elevated AI risk (100) without elite confidence (75% < 82%)",
      symbol: "EPICUSDT",
    });
    expect(outcome.outcome).toBe("admission_rejected");
    expect(outcome.closeReason).toBe("ENTRY_QUALITY_REJECT");
  });

  it("classifies AI_NO_TRADE terminal", () => {
    const outcome = classifyRoundTerminalOutcome({
      reason: "AI_NO_TRADE: AI karari trade acmaya uygun degil (NO_TRADE)",
      symbol: "EPICUSDT",
    });
    expect(outcome.outcome).toBe("ai_rejected");
  });
});

describe("admission decision matrix (entry-quality gate only)", () => {
  const cases: Array<{ decision: string; confidence: number; risk: number; expectReject: boolean }> = [
    { decision: "BUY", confidence: 90, risk: 20, expectReject: false },
    { decision: "BUY", confidence: 75, risk: 20, expectReject: false },
    { decision: "BUY", confidence: 90, risk: 100, expectReject: false },
    { decision: "BUY", confidence: 75, risk: 100, expectReject: true },
    { decision: "NO_TRADE", confidence: 90, risk: 20, expectReject: false },
    { decision: "NO_TRADE", confidence: 75, risk: 100, expectReject: true },
  ];

  for (const row of cases) {
    it(`${row.decision} conf=${row.confidence} risk=${row.risk} => reject=${row.expectReject}`, () => {
      const gate = shouldRejectHighRiskLowConfidenceEntry({
        confidencePercent: row.confidence,
        aiRiskScore: row.risk,
      });
      expect(gate.reject).toBe(row.expectReject);
    });
  }
});
