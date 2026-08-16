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

  it("relaxes thresholds after consecutive rejections", () => {
    const relaxed = applyAdaptiveThresholds({
      baseMinConfidence: 38,
      baseMinQualityScore: 60,
      baseMinScannerScore: 38,
      baseMinScannerConfidence: 40,
      consecutiveRejections: 9,
    });
    expect(relaxed.minConfidence).toBeLessThan(38);
    expect(relaxed.minQualityScore).toBeLessThan(60);
    expect(relaxed.relaxation.explorationMode).toBe(true);
  });

  it("accepts candidate when only advisory blockers remain after relaxation", () => {
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
    expect(decision.waivedBlockers.length).toBeGreaterThan(0);
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

  it("waives important filters in exploration mode with decent composite", () => {
    const relaxation = computeAdaptiveRelaxation(9);
    expect(relaxation.explorationMode).toBe(true);
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
    expect(decision.ok).toBe(true);
  });
});
