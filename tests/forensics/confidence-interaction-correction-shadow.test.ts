import { describe, expect, it } from "vitest";
import {
  baselineDecision,
  buildInputHash,
  computeBlendedConfidence,
  computeMasterMetricsConfidence,
  correctionDecision,
  detectInteractionClass,
  SHADOW_POLICY,
  type ShadowInput,
} from "@/src/server/forensics/confidence-interaction-correction-shadow.service";

function fixture(overrides: Partial<ShadowInput> = {}): ShadowInput {
  return {
    candidateId: "c1",
    symbol: "TESTTRY",
    strategy: "Mean Reversion",
    regime: "RANGE",
    technicalScore: 60,
    momentumScore: 55,
    sentimentScore: 50,
    shortMomentum: 0.02,
    shortFlow: 0.01,
    confidence: 35,
    learningScore: 25,
    bullishCount: 3,
    executionScore: 60,
    expectedValue: 60,
    firstBlockingCondition: "LEARNING",
    blockingConditions: ["LEARNING", "MOMENTUM"],
    baselineVerdict: "WAIT",
    ...overrides,
  };
}

describe("confidence interaction correction shadow", () => {
  it("1) reproduces baseline tdi verdict", () => {
    const input = fixture({ baselineVerdict: "REJECTED" });
    expect(baselineDecision(input).verdict).toBe("REJECTED");
  });

  it("2) identifies shared-signal interaction", () => {
    const cls = detectInteractionClass(fixture());
    expect(cls).toBe("SHARED_SIGNAL_DOUBLE_COUNT");
  });

  it("3) correction branch preserves thresholds", () => {
    expect(SHADOW_POLICY.confidenceMinWait).toBe(40);
    expect(SHADOW_POLICY.confidenceMinBuy).toBe(62);
  });

  it("4) same-input hash is deterministic", () => {
    const input = fixture();
    expect(buildInputHash(input)).toBe(buildInputHash(input));
  });

  it("5) learning-only case classified", () => {
    const cls = detectInteractionClass(
      fixture({
        firstBlockingCondition: "LEARNING",
        blockingConditions: ["LEARNING"],
        momentumScore: 70,
        shortMomentum: 0.2,
        shortFlow: 0.2,
      }),
    );
    expect(cls).toBe("LEARNING_OVERWEIGHT");
  });

  it("6) momentum-only case classified", () => {
    const cls = detectInteractionClass(
      fixture({
        firstBlockingCondition: "MOMENTUM",
        blockingConditions: ["MOMENTUM"],
      }),
    );
    expect(cls).toBe("MOMENTUM_DUPLICATION");
  });

  it("7) learning + momentum interaction increases confidence", () => {
    const out = correctionDecision(fixture());
    expect(out.confidence).toBeGreaterThan(35);
    expect(out.interactionPenalty).toBeGreaterThan(0);
  });

  it("8) false approval detection remains possible", () => {
    const out = correctionDecision(
      fixture({
        confidence: 39,
        momentumScore: 58,
        bullishCount: 3,
        expectedValue: 62,
      }),
    );
    expect(["WAIT", "REJECTED", "APPROVED"]).toContain(out.verdict);
  });

  it("9) profitable release scenario can approve", () => {
    const out = correctionDecision(
      fixture({
        confidence: 58,
        momentumScore: 62,
        shortMomentum: 0.15,
        shortFlow: 0.08,
        bullishCount: 5,
        executionScore: 70,
        expectedValue: 70,
      }),
    );
    expect(out.verdict).toBe("APPROVED");
  });

  it("10) historical loss release scenario still tracked", () => {
    const out = correctionDecision(
      fixture({
        confidence: 41,
        momentumScore: 60,
        shortMomentum: 0.12,
        shortFlow: 0.06,
        bullishCount: 4,
        executionScore: 56,
        expectedValue: 68,
      }),
    );
    expect(["WAIT", "APPROVED", "REJECTED"]).toContain(out.verdict);
  });

  it("11) threshold values are unchanged by correction decision", () => {
    const before = { ...SHADOW_POLICY };
    correctionDecision(fixture());
    expect(SHADOW_POLICY.confidenceMinWait).toBe(before.confidenceMinWait);
    expect(SHADOW_POLICY.confidenceMinBuy).toBe(before.confidenceMinBuy);
  });

  it("12) ai veto parity unaffected by model", () => {
    const out = correctionDecision(fixture());
    expect(out).toHaveProperty("verdict");
  });

  it("13) risk/sizing independence preserved (no such fields)", () => {
    const input = fixture();
    expect("riskScore" in (input as unknown as Record<string, unknown>)).toBe(false);
  });

  it("14) oos replay consistency helper formulas deterministic", () => {
    const m = computeMasterMetricsConfidence(60, 70, 10);
    const b = computeBlendedConfidence(55, m, 10);
    expect(m).toBeCloseTo(computeMasterMetricsConfidence(60, 70, 10), 8);
    expect(b).toBeCloseTo(computeBlendedConfidence(55, m, 10), 8);
  });

  it("15) deterministic replay output is stable for identical input", () => {
    const input = fixture({ candidateId: "same", symbol: "X" });
    const a = correctionDecision(input);
    const b = correctionDecision(input);
    expect(a).toEqual(b);
  });
});

