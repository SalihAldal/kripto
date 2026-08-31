import { describe, expect, it } from "vitest";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import {
  buildDecisionFeatureField,
  buildDecisionFeatureSnapshot,
  computeDecisionFeatureHash,
  computeMomentumScoreForSnapshot,
  preserveDecisionFeatureSnapshot,
  verifyMomentumFormulaParity,
  MOMENTUM_FORMULA_VERSION,
} from "@/src/server/forensics/decision-time-tdi-telemetry.service";

function makeCandidate(overrides: Partial<ScannerCandidate["context"]["metadata"]> = {}): ScannerCandidate {
  return {
    rank: 1,
    score: { score: 64, confidence: 58, reasons: [] },
    context: {
      symbol: "TESTTRY",
      lastPrice: 100,
      volume24h: 1_000_000,
      spreadPercent: 0.1,
      volatilityPercent: 1.2,
      orderBookImbalance: 0.2,
      fakeSpikeScore: 0,
      pumpRisk: 20,
      pumpIntensity: 30,
      volumeSpikePercent: 50,
      metadata: {
        shortMomentumPercent: 0.42,
        shortFlowImbalance: 0.15,
        change5m: 0.8,
        change15m: 1.2,
        candidateTimestamp: "2026-08-28T10:00:00.000Z",
        roundId: "3",
        runId: "run-abc",
        sessionId: "session-xyz",
        ...overrides,
      },
    },
    ai: undefined,
  };
}

function makeAi(overrides: Partial<AIConsensusResult> = {}): AIConsensusResult {
  return {
    finalDecision: "BUY",
    finalConsensusDecision: "BUY",
    finalConfidence: 62,
    finalConsensusConfidence: 60,
    finalRiskScore: 35,
    score: 72,
    generatedAt: "2026-08-28T10:00:05.000Z",
    roleScores: [
      { role: "AI-1_TECHNICAL", decision: "BUY", score: 71, confidence: 65, reasoning: "ok" },
      { role: "AI-2_SENTIMENT", decision: "BUY", score: 58, confidence: 55, reasoning: "ok" },
      { role: "AI-3_RISK", decision: "BUY", score: 52, confidence: 50, reasoning: "ok" },
    ],
    decisionPayload: {
      timeframeAnalysis: {
        alignmentScore: 73,
        dominantTrend: "BULLISH",
        capturedAt: "2026-08-28T10:00:04.000Z",
      },
      masterDecisionEngine: {
        matrix: { learning: 48 },
      },
    },
    ...overrides,
  } as AIConsensusResult;
}

describe("P3 decision-time TDI telemetry", () => {
  it("1. decision snapshot created", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
      roundId: "3",
      runId: "run-abc",
      sessionId: "session-xyz",
    });
    expect(snapshot.schemaVersion).toBe("decision-feature-snapshot-v1");
    expect(snapshot.candidateId).toBe("cand-1");
  });

  it("2. snapshot immutable", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("3. correct decision timestamp", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.decisionTimestamp).toBe("2026-08-28T10:00:05.000Z");
  });

  it("4. candidateId binding", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "hybrid:TESTTRY:abc",
    });
    expect(snapshot.candidateId).toBe("hybrid:TESTTRY:abc");
  });

  it("5. roundId binding", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
      roundId: "7",
    });
    expect(snapshot.roundId).toBe("7");
  });

  it("6. runId binding", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
      runId: "run-99",
    });
    expect(snapshot.runId).toBe("run-99");
  });

  it("7. momentum formula parity", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.momentumFormulaVersion).toBe(MOMENTUM_FORMULA_VERSION);
    expect(verifyMomentumFormulaParity(snapshot)).toBe(true);
  });

  it("8. change5m persistence", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.momentumRaw.change5m.state).toBe("AVAILABLE");
    expect(snapshot.momentumRaw.change5m.value).toBe(0.8);
  });

  it("9. change15m persistence", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.momentumRaw.change15m.state).toBe("AVAILABLE");
    expect(snapshot.momentumRaw.change15m.value).toBe(1.2);
  });

  it("10. technical persistence", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.technicalScore.state).toBe("AVAILABLE");
    expect(snapshot.technicalScore.value).toBe(71);
  });

  it("11. confidence persistence", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.confidence.finalConfidence.value).toBe(62);
    expect(snapshot.confidence.consensusConfidence.value).toBe(60);
    expect(snapshot.confidence.aiConfidence.value).toBe(62);
  });

  it("12. MTF persistence", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.mtf.mtfAlignment.value).toBe(73);
    expect(snapshot.mtf.mtfState.value).toBe("BULLISH");
  });

  it("13. missing-value semantics", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate({ change5m: undefined, change15m: undefined }),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.momentumRaw.change5m.state).toBe("MISSING");
    expect(snapshot.momentumRaw.change5m.value).toBeNull();
    expect(snapshot.momentumRaw.change15m.state).toBe("MISSING");
    expect(snapshot.momentumScorePartialInputs).toBe(true);
  });

  it("14. stale-value semantics", () => {
    const field = buildDecisionFeatureField(0.5, {
      source: "test",
      unit: "percent_points",
      decisionTimestamp: "2026-08-28T12:00:00.000Z",
      featureTimestamp: "2026-08-28T10:00:00.000Z",
      staleAfterMs: 30 * 60 * 1000,
    });
    expect(field.state).toBe("STALE");
  });

  it("15. no zero-default fabrication for missing raw fields", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate({ shortMomentumPercent: undefined }),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.momentumRaw.shortMomentum.value).toBeNull();
    expect(snapshot.momentumRaw.shortMomentum.state).toBe("MISSING");
  });

  it("16. no post-entry overwrite via preserveDecisionFeatureSnapshot", () => {
    const original = { decisionFeatureSnapshot: { candidateId: "keep" }, closeReason: "TP" };
    const merged = preserveDecisionFeatureSnapshot(original, { closeReason: "SL", decisionFeatureSnapshot: { candidateId: "new" } });
    expect((merged.decisionFeatureSnapshot as { candidateId: string }).candidateId).toBe("keep");
  });

  it("17. hash consistency", () => {
    const a = computeDecisionFeatureHash({
      candidateId: "c1",
      roundId: "1",
      decisionTimestamp: "2026-08-28T10:00:05.000Z",
      momentumScore: 20,
      shortMomentum: 0.4,
      shortFlow: 0.1,
      change5m: 0.5,
      change15m: 0.6,
      technicalScore: 70,
      confidence: 60,
      mtfScore: 73,
    });
    const b = computeDecisionFeatureHash({
      candidateId: "c1",
      roundId: "1",
      decisionTimestamp: "2026-08-28T10:00:05.000Z",
      momentumScore: 20,
      shortMomentum: 0.4,
      shortFlow: 0.1,
      change5m: 0.5,
      change15m: 0.6,
      technicalScore: 70,
      confidence: 60,
      mtfScore: 73,
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("18. historical unavailable fields remain unavailable", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate({ change5m: undefined, change15m: undefined, shortMomentumPercent: undefined }),
      ai: makeAi({ roleScores: [] }),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot.momentumRaw.shortMomentum.state).toBe("MISSING");
    expect(snapshot.technicalScore.state).toBe("MISSING");
  });

  it("19. no future-data contamination (feature timestamp <= decision timestamp)", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate({ candidateTimestamp: "2026-08-28T09:59:00.000Z" }),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    const decisionMs = new Date(snapshot.decisionTimestamp).getTime();
    expect(new Date(snapshot.momentumRaw.shortMomentum.timestamp!).getTime()).toBeLessThanOrEqual(decisionMs);
    expect(new Date(snapshot.mtf.mtfTimestamp.timestamp!).getTime()).toBeLessThanOrEqual(decisionMs);
  });

  it("20. PnL path unchanged (telemetry-only export surface)", () => {
    const snapshot = buildDecisionFeatureSnapshot({
      candidate: makeCandidate(),
      ai: makeAi(),
      decisionId: "dec-1",
      candidateId: "cand-1",
    });
    expect(snapshot).not.toHaveProperty("netPnL");
    expect(snapshot).not.toHaveProperty("realizedPnl");
    expect(computeMomentumScoreForSnapshot({ shortMomentum: 0.42, change5m: 0.8, change15m: 1.2 }).value).toBeGreaterThan(0);
  });

  it("preserveDecisionFeatureSnapshot keeps existing snapshot", () => {
    const next = preserveDecisionFeatureSnapshot({ foo: 1, decisionFeatureSnapshot: { hash: "x" } }, { foo: 2 });
    expect(next.foo).toBe(2);
    expect((next.decisionFeatureSnapshot as { hash: string }).hash).toBe("x");
  });
});
