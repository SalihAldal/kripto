import { describe, expect, it } from "vitest";
import {
  computeDrawdownMetrics,
  resolveAdaptiveNotionalMultiplier,
  resolveRiskBudgetNeutralScale,
  resolveRiskEfficiencyAdjustment,
  resolveVolatilityAwareStopLossPercent,
  RISK_EFFICIENCY_POLICY,
} from "../src/server/execution/risk-efficiency.service";

describe("risk-efficiency", () => {
  it("widens stop in high ATR without tightening below base", () => {
    const low = resolveVolatilityAwareStopLossPercent({
      baseStopLossPercent: 0.8,
      atrPercent: 0.4,
      volatilityPercent: 1.2,
    });
    expect(low.source).toBe("base");
    expect(low.stopLossPercent).toBeGreaterThanOrEqual(0.8);

    const high = resolveVolatilityAwareStopLossPercent({
      baseStopLossPercent: 0.8,
      atrPercent: 2.1,
      volatilityPercent: 3.4,
    });
    expect(high.source).toBe("atr_blend");
    expect(high.stopLossPercent).toBeGreaterThan(0.8);
  });

  it("reduces notional on consecutive losses without blocking", () => {
    const base = resolveAdaptiveNotionalMultiplier({
      confidencePercent: 75,
      volatilityPercent: 1.5,
      aiRiskScore: 45,
      marketRegimeRiskMultiplier: 1,
      consecutiveLosses: 0,
      equityDrawdownPercent: 0,
    });
    const stressed = resolveAdaptiveNotionalMultiplier({
      confidencePercent: 75,
      volatilityPercent: 1.5,
      aiRiskScore: 45,
      marketRegimeRiskMultiplier: 1,
      consecutiveLosses: 3,
      equityDrawdownPercent: 9,
    });
    expect(stressed.multiplier).toBeLessThan(base.multiplier);
    expect(stressed.multiplier).toBeGreaterThanOrEqual(0.72);
  });

  it("preserves elite setup sizing floor", () => {
    const elite = resolveAdaptiveNotionalMultiplier({
      confidencePercent: 91,
      volatilityPercent: 2.8,
      aiRiskScore: 42,
      marketRegimeRiskMultiplier: 0.85,
      consecutiveLosses: 0,
      equityDrawdownPercent: 0,
    });
    expect(elite.multiplier).toBeGreaterThanOrEqual(0.92);
  });

  it("keeps dollar risk neutral when stop widens", () => {
    const scale = resolveRiskBudgetNeutralScale({
      baseStopLossPercent: 0.8,
      adjustedStopLossPercent: 1.6,
    });
    expect(scale).toBeCloseTo(0.5, 2);
  });

  it("computes drawdown metrics from pnl series", () => {
    const metrics = computeDrawdownMetrics([10, -3, -2, 8, -1], 100);
    expect(metrics.maxDrawdown).toBeGreaterThan(0);
    expect(metrics.totalPnl).toBe(12);
    expect(metrics.recoveryFactor).toBeGreaterThan(0);
  });

  it("applies portfolio and repeat-symbol exposure scaling", () => {
    const result = resolveRiskEfficiencyAdjustment({
      baseStopLossPercent: 0.8,
      atrPercent: 1.5,
      volatilityPercent: 2.2,
      confidencePercent: 72,
      aiRiskScore: 78,
      marketRegimeRiskMultiplier: 0.85,
      marketRegime: "trending",
      consecutiveLosses: 1,
      equityDrawdownPercent: 4,
      notional: 980,
      quantity: 0.33,
      accountEquity: 10_000,
      symbol: "ADATRY",
      strategy: "trend_pullback",
      openPositions: [
        {
          id: "1",
          symbol: "ADATRY",
          side: "BUY",
          quantity: 0.2,
          entryPrice: 1800,
          currentPrice: 1790,
          strategy: "trend_pullback",
        },
      ],
    });
    expect(result.adjustedNotional).toBeLessThan(980);
    expect(result.notionalMultiplier).toBeLessThan(1);
    expect(result.stopLossPercent).toBeGreaterThanOrEqual(0.8);
  });
});
