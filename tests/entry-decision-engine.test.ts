import { describe, expect, it } from "vitest";
import {
  applyAdaptiveThresholds,
  classifyFilterReason,
  computeAdaptiveRelaxation,
  resolveAdaptiveEntryDecision,
} from "@/src/server/execution/entry-decision-engine.service";

describe("entry decision engine", () => {
  it("classifies dump and quality filters by priority", () => {
    expect(classifyFilterReason("Dump tespiti: son 15dk -4%")).toBe("CRITICAL");
    expect(classifyFilterReason("Kalite skoru dusuk (45/100 < 60)")).toBe("IMPORTANT");
    expect(classifyFilterReason("regime chop warning")).toBe("ADVISORY");
  });

  it("keeps thresholds invariant across consecutive rejections", () => {
    const relaxed = applyAdaptiveThresholds({
      baseMinConfidence: 38,
      baseMinQualityScore: 60,
      baseMinScannerScore: 38,
      baseMinScannerConfidence: 40,
      consecutiveRejections: 9,
    });
    expect(relaxed.minConfidence).toBe(38);
    expect(relaxed.minQualityScore).toBe(60);
    expect(relaxed.minScannerScore).toBe(38);
    expect(relaxed.minScannerConfidence).toBe(40);
    expect(relaxed.relaxation.explorationMode).toBe(false);
  });

  it("accepts candidate when only advisory blockers remain", () => {
    const decision = resolveAdaptiveEntryDecision({
      reasons: ["regime chop warning", "EMA trend uyumsuz (EMA50=0.6550, EMA200=0.6551)"],
      compositeAvg: 56,
      consecutiveRejections: 6,
      dataDegraded: true,
      confidence: 42,
      effectiveConfidenceFloor: 36,
      effectiveQualityFloor: 48,
    });
    expect(decision.ok).toBe(true);
    expect(decision.advisoryBlockers.length).toBeGreaterThanOrEqual(0);
  });

  it("blocks on critical filters regardless of relaxation", () => {
    const decision = resolveAdaptiveEntryDecision({
      reasons: ["AI SELL sinyali (SELL)", "regime chop warning"],
      compositeAvg: 70,
      consecutiveRejections: 12,
      confidence: 80,
      effectiveConfidenceFloor: 32,
      effectiveQualityFloor: 35,
    });
    expect(decision.ok).toBe(false);
    expect(decision.primaryBlocker).toMatch(/AI SELL/i);
  });

  it("does not waive important filters with high rejection count", () => {
    const relaxation = computeAdaptiveRelaxation(9);
    expect(relaxation.explorationMode).toBe(false);
    const decision = resolveAdaptiveEntryDecision({
      reasons: [
        "confidence 36.00 < 38",
        "non-pump kalite dusuk (composite=52.0, sentiment=45.0, mtf=40.0)",
        "regime chop warning",
      ],
      compositeAvg: 52,
      consecutiveRejections: 9,
      confidence: 36,
      effectiveConfidenceFloor: 34,
      effectiveQualityFloor: 44,
    });
    expect(decision.ok).toBe(false);
    expect(decision.primaryBlocker).toContain("confidence");
  });

  it("keeps verdict and first blocker invariant for rejection counters", () => {
    const counters = [0, 1, 3, 6, 9, 15, 50, 100];
    const decisions = counters.map((count) =>
      resolveAdaptiveEntryDecision({
        reasons: ["confidence 36.00 < 38", "regime chop warning"],
        compositeAvg: 52,
        consecutiveRejections: count,
        confidence: 36,
        effectiveConfidenceFloor: 38,
        effectiveQualityFloor: 44,
      }),
    );
    for (const decision of decisions.slice(1)) {
      expect(decision.ok).toBe(decisions[0].ok);
      expect(decision.primaryBlocker).toBe(decisions[0].primaryBlocker);
      expect(decision.secondaryBlockers).toEqual(decisions[0].secondaryBlockers);
    }
  });
});
