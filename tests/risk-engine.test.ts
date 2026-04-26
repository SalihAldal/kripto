import { describe, expect, it } from "vitest";
import { evaluateRiskRules } from "../src/server/risk/risk-evaluation.service";

describe("risk-engine", () => {
  const config = {
    maxRiskPerTrade: 1.2,
    maxDailyLossPercent: 2.5,
    maxWeeklyLossPercent: 7,
    dailyLossReferenceTry: 5000,
    weeklyLossReferenceTry: 5000,
    maxOpenPositions: 3,
    minConfidenceThreshold: 65,
    maxSpreadThreshold: 0.25,
    minLiquidityThreshold: 5_000_000,
    minExpectedProfitThreshold: 0.2,
    maxSlippageThreshold: 0.45,
    cooldownMinutes: 30,
    consecutiveLossBreaker: 3,
    apiFailureBreaker: 4,
    abnormalVolatilityThreshold: 3.2,
    emergencyBrakeEnabled: true,
    stopLossRequired: true,
  } as const;

  it("passes safe metrics", () => {
    const reasons = evaluateRiskRules({
      config,
      metrics: {
        confidencePercent: 80,
        spreadPercent: 0.1,
        liquidity24h: 20_000_000,
        expectedProfitPercent: 0.7,
        slippagePercent: 0.2,
        volatilityPercent: 1.4,
        riskPerTradePercent: 0.7,
        stopLossConfigured: true,
      },
      state: {
        paused: false,
        openPositionCount: 1,
        dailyLossAbs: 0.6,
        dailyLossPercent: 0.012,
        weeklyLossAbs: 1.3,
        weeklyLossPercent: 0.026,
        consecutiveLosses: 0,
        apiFailureCount: 0,
      },
    });
    expect(reasons).toHaveLength(0);
  });

  it("blocks risky metrics", () => {
    const reasons = evaluateRiskRules({
      config,
      metrics: {
        confidencePercent: 40,
        spreadPercent: 0.7,
        liquidity24h: 100_000,
        expectedProfitPercent: 0.01,
        slippagePercent: 1.2,
        volatilityPercent: 5.2,
        riskPerTradePercent: 3,
        stopLossConfigured: false,
      },
      state: {
        paused: true,
        pauseReason: "manual",
        openPositionCount: 5,
        dailyLossAbs: 4,
        dailyLossPercent: 8,
        weeklyLossAbs: 12,
        weeklyLossPercent: 11,
        consecutiveLosses: 4,
        apiFailureCount: 5,
        apiBlockedUntil: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(reasons.length).toBeGreaterThan(6);
    expect(reasons.join(" | ")).toContain("Confidence below minimum threshold");
    expect(reasons.join(" | ")).toContain("API breaker cooldown active");
  });
});
