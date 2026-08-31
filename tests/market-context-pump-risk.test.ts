import { describe, expect, it } from "vitest";
import { computePumpRisk } from "@/src/server/scanner/market-context-builder";

describe("pump risk semantics contract", () => {
  it("computes available formula-based score", () => {
    const result = computePumpRisk({
      spreadPercent: 0.2,
      fakeSpikeScore: 1.1,
      priceDispersionPercent: 0.4,
      orderBookImbalance: 0.2,
    });
    expect(result.status).toBe("AVAILABLE");
    expect(result.reason).toContain("FORMULA");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("marks capped when raw score exceeds 100", () => {
    const result = computePumpRisk({
      spreadPercent: 0.7,
      fakeSpikeScore: 3.2,
      priceDispersionPercent: 2.5,
      orderBookImbalance: 0.9,
    });
    expect(result.status).toBe("AVAILABLE");
    expect(result.capped).toBe(true);
    expect(result.score).toBe(100);
  });

  it("returns explicit unavailable on invalid input", () => {
    const result = computePumpRisk({
      spreadPercent: Number.NaN,
      fakeSpikeScore: 1,
      priceDispersionPercent: 1,
      orderBookImbalance: 0.1,
    });
    expect(result.status).toBe("UNAVAILABLE");
    expect(result.reason).toBe("PUMP_RISK_INPUT_UNAVAILABLE");
    expect(result.score).toBe(0);
  });
});
