import { describe, expect, it } from "vitest";
import {
  getEffectivePollMs,
  getNextActiveTrendIndex,
  getRiskFreshness,
  isSameTimeline,
  isSameRiskPulse,
  normalizeTimeline,
  pickSelectedTrend,
  type RiskPulse,
  type RiskTimelineRow,
} from "@/src/features/shell/use-risk-pulse";

describe("use-risk-pulse helpers", () => {
  it("isSameRiskPulse returns true only when risk payload is identical", () => {
    const base: RiskPulse = {
      strictness: "strict",
      minConfidence: 92,
      reason: "Policy tightened",
      reasonData: {
        winRatePercent: 54.2,
        maxDrawdown: 8.9,
        deltaConfidence: 4,
      },
    };

    expect(isSameRiskPulse(base, { ...base })).toBe(true);
    expect(isSameRiskPulse(null, base)).toBe(false);
    expect(isSameRiskPulse(base, { ...base, minConfidence: 93 })).toBe(false);
  });

  it("normalizeTimeline keeps only latest rows", () => {
    const rows: RiskTimelineRow[] = Array.from({ length: 7 }).map((_, idx) => ({
      at: `2026-01-01T00:00:0${idx}Z`,
      strictness: "normal",
      minConfidence: 80 + idx,
      reason: `row-${idx}`,
    }));

    const normalized = normalizeTimeline(rows, 5);
    expect(normalized).toHaveLength(5);
    expect(normalized[0]?.reason).toBe("row-2");
    expect(normalized[4]?.reason).toBe("row-6");
  });

  it("isSameTimeline compares rows without JSON stringify", () => {
    const a: RiskTimelineRow[] = [{ at: "1", strictness: "normal", minConfidence: 90, reason: "x" }];
    const b: RiskTimelineRow[] = [{ at: "1", strictness: "normal", minConfidence: 90, reason: "x" }];
    const c: RiskTimelineRow[] = [{ at: "2", strictness: "strict", minConfidence: 92, reason: "y" }];
    expect(isSameTimeline(a, b)).toBe(true);
    expect(isSameTimeline(a, c)).toBe(false);
  });

  it("getNextActiveTrendIndex handles empty and clamped states", () => {
    expect(getNextActiveTrendIndex(null, 0)).toBeNull();
    expect(getNextActiveTrendIndex(null, 3)).toBe(2);
    expect(getNextActiveTrendIndex(5, 2)).toBe(1);
    expect(getNextActiveTrendIndex(1, 4)).toBe(1);
  });

  it("pickSelectedTrend returns active item or latest fallback", () => {
    const timeline: RiskTimelineRow[] = [
      { at: "a", strictness: "normal", minConfidence: 85, reason: "A" },
      { at: "b", strictness: "strict", minConfidence: 90, reason: "B" },
    ];
    expect(pickSelectedTrend(timeline, 0)?.reason).toBe("A");
    expect(pickSelectedTrend(timeline, null)?.reason).toBe("B");
    expect(pickSelectedTrend([], null)).toBeUndefined();
  });

  it("getEffectivePollMs switches between visible and hidden intervals", () => {
    expect(getEffectivePollMs(true, 10000)).toBe(10000);
    expect(getEffectivePollMs(false, 10000)).toBe(30000);
    expect(getEffectivePollMs(false, 10000, 45000)).toBe(45000);
  });

  it("getRiskFreshness classifies pulse freshness", () => {
    expect(getRiskFreshness(null)).toBe("cold");
    expect(getRiskFreshness(new Date().toISOString(), 45000)).toBe("fresh");
    expect(getRiskFreshness(new Date(Date.now() - 60000).toISOString(), 45000)).toBe("stale");
  });
});
