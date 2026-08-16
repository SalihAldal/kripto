import { describe, expect, it } from "vitest";
import {
  computeRiskAdjustedMetrics,
  resolveRiskAdjustedNotionalMultiplier,
  RISK_ADJUSTED_POLICY,
} from "../src/server/execution/risk-adjusted-performance.service";

describe("risk-adjusted-performance", () => {
  it("boosts elite confidence calibrated setups", () => {
    const result = resolveRiskAdjustedNotionalMultiplier({
      confidencePercent: 91,
      aiRiskScore: 45,
      marketRegime: "ranging",
      strategy: "mean_reversion",
      volatilityPercent: 1.2,
    });
    expect(result.multiplier).toBeGreaterThan(1);
    expect(result.factors.eliteBoost).toBe(RISK_ADJUSTED_POLICY.eliteConfidenceBoost);
  });

  it("applies variance guard for moderate confidence in unstable combos", () => {
    const result = resolveRiskAdjustedNotionalMultiplier({
      confidencePercent: 76,
      aiRiskScore: 46,
      marketRegime: "trending",
      strategy: "trend_pullback",
      volatilityPercent: 1.8,
    });
    expect(result.multiplier).toBeLessThan(1);
  });

  it("guards volatile regime with sub-threshold confidence", () => {
    const result = resolveRiskAdjustedNotionalMultiplier({
      confidencePercent: 75,
      aiRiskScore: 35,
      marketRegime: "volatile",
      strategy: "momentum_scalp",
      volatilityPercent: 2.8,
    });
    expect(result.factors.regimeFactor).toBeLessThanOrEqual(RISK_ADJUSTED_POLICY.volatileRegimeVarianceGuard);
  });

  it("computes sharpe and sortino from pnl series", () => {
    const metrics = computeRiskAdjustedMetrics([12, -2, 8, 15, -1, 10], 10_000);
    expect(metrics.sharpeRatio).toBeGreaterThan(0);
    expect(metrics.sortinoRatio).toBeGreaterThan(metrics.sharpeRatio * 0.5);
    expect(metrics.portfolioStability).toBeGreaterThan(0);
  });
});
