import { describe, expect, it } from "vitest";
import {
  shouldRejectHighRiskLowConfidenceEntry,
  resolveRegimeTakeProfitBoost,
  TRADE_QUALITY_POLICY,
} from "../src/server/execution/profit-thresholds";
import { resolveSmartTakeProfitPercent } from "../src/server/execution/smart-targeting.service";

describe("trade-quality-policy", () => {
  it("rejects high AI risk without elite confidence", () => {
    const result = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: 77,
      aiRiskScore: 78.28,
    });
    expect(result.reject).toBe(true);
    expect(result.reason).toContain("Entry quality");
  });

  it("allows high AI risk when confidence is elite", () => {
    const result = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: 84,
      aiRiskScore: 78,
    });
    expect(result.reject).toBe(false);
  });

  it("allows moderate risk at standard confidence", () => {
    const result = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: 72,
      aiRiskScore: 68,
    });
    expect(result.reject).toBe(false);
  });

  it("boosts TP in trending regime for high confidence", () => {
    const boost = resolveRegimeTakeProfitBoost({
      marketRegime: "STRONG_BULLISH_TREND",
      confidencePercent: 76,
    });
    expect(boost).toBe(TRADE_QUALITY_POLICY.trendingTpConfidenceBoost);
  });

  it("applies regime TP boost through smart targeting", () => {
    const base = resolveSmartTakeProfitPercent({
      baseTpPercent: 1.4,
      volatilityPercent: 1.2,
      confidencePercent: 78,
      expectedProfitPercent: 1.6,
    });
    const boosted = resolveSmartTakeProfitPercent({
      baseTpPercent: 1.4,
      volatilityPercent: 1.2,
      confidencePercent: 78,
      expectedProfitPercent: 1.6,
      marketRegime: "STRONG_BULLISH_TREND",
    });
    expect(boosted).toBeGreaterThan(base);
  });
});
