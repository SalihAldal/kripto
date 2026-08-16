import { describe, expect, it } from "vitest";
import {
  aggregatePortfolioAllocationKpis,
  computeCapitalUtilization,
  resolveCorrelationAllocationFactor,
  resolveOpportunityAllocationWeights,
  resolvePortfolioAllocationPolicy,
} from "../src/server/execution/portfolio-allocation-intelligence.service";
import { resolveRiskEfficiencyAdjustment } from "../src/server/execution/risk-efficiency.service";
import type { PortfolioPositionInput } from "../src/server/trading-core/portfolio/portfolio-types";

describe("portfolio allocation intelligence", () => {
  it("weights high-confidence high-EV opportunities higher", () => {
    const low = resolveOpportunityAllocationWeights({
      confidencePercent: 58,
      expectedProfitPercent: 0.2,
      rankingScore: 52,
      aiRiskScore: 62,
    });
    const high = resolveOpportunityAllocationWeights({
      confidencePercent: 86,
      expectedProfitPercent: 0.9,
      rankingScore: 78,
      aiRiskScore: 38,
    });
    expect(high.weight).toBeGreaterThan(low.weight);
  });

  it("reduces allocation factor for concentrated correlation groups", () => {
    const positions: PortfolioPositionInput[] = [
      {
        id: "1",
        symbol: "BTCTRY",
        side: "BUY",
        quantity: 0.01,
        entryPrice: 2_900_000,
        currentPrice: 2_900_000,
        strategy: "trend_pullback",
      },
      {
        id: "2",
        symbol: "ETHTRY",
        side: "BUY",
        quantity: 0.2,
        entryPrice: 90_000,
        currentPrice: 90_000,
        strategy: "trend_pullback",
      },
    ];
    const factor = resolveCorrelationAllocationFactor({
      symbol: "SOLTRY",
      openPositions: positions,
      accountEquity: 10_000,
      requestedNotional: 900,
    });
    expect(factor.group).toBe("majors");
    expect(factor.factor).toBeLessThan(1);
  });

  it("blocks portfolio allocation when SmartPortfolioManager returns BLOCK", () => {
    const positions: PortfolioPositionInput[] = Array.from({ length: 4 }).map((_, index) => ({
      id: String(index),
      symbol: "BTCTRY",
      side: "BUY" as const,
      quantity: 0.02,
      entryPrice: 2_900_000,
      currentPrice: 2_900_000,
      strategy: "trend_pullback",
    }));
    const policy = resolvePortfolioAllocationPolicy({
      accountEquity: 10_000,
      openPositions: positions,
      symbol: "BTCTRY",
      strategy: "trend_pullback",
      requestedNotional: 2_500,
      confidencePercent: 70,
      expectedProfitPercent: 0.4,
      rankingScore: 65,
      aiRiskScore: 55,
      marketRegime: "trending",
    });
    expect(policy.portfolioBlocked).toBe(true);
    expect(policy.adjustedNotional).toBe(0);
  });

  it("computes capital utilization from open positions", () => {
    const utilization = computeCapitalUtilization({
      accountEquity: 10_000,
      openPositions: [
        {
          id: "1",
          symbol: "BTCTRY",
          side: "BUY",
          quantity: 0.001,
          entryPrice: 2_900_000,
          currentPrice: 2_900_000,
        },
      ],
      requestedNotional: 500,
    });
    expect(utilization.utilized).toBeGreaterThan(0);
    expect(utilization.utilizationPercent).toBeGreaterThan(0);
  });

  it("integrates allocation telemetry into risk efficiency adjustment", () => {
    const result = resolveRiskEfficiencyAdjustment({
      baseStopLossPercent: 0.8,
      atrPercent: 1.2,
      volatilityPercent: 1.8,
      confidencePercent: 84,
      aiRiskScore: 42,
      marketRegimeRiskMultiplier: 0.92,
      marketRegime: "trending",
      consecutiveLosses: 0,
      equityDrawdownPercent: 2,
      notional: 800,
      quantity: 0.25,
      accountEquity: 10_000,
      symbol: "SOLTRY",
      strategy: "trend_pullback",
      openPositions: [],
      expectedProfitPercent: 0.6,
      rankingScore: 74,
    });
    expect(result.portfolioAllocation).toBeDefined();
    expect(result.adjustedNotional).toBeGreaterThan(0);
    expect(result.adjustedNotional).not.toBe(800);
  });

  it("aggregates portfolio allocation KPIs", () => {
    const telemetry = [
      {
        availableCapital: 9000,
        capitalUtilized: 1000,
        positionSize: 450,
        portfolioExposure: 14.5,
        assetCorrelationGroup: "majors",
        assetCorrelationScore: 12,
        sectorExposure: 10,
        riskBudget: 8,
        expectedValue: 0.5,
        aiConfidence: 78,
        opportunityScore: 70,
        portfolioConcentration: 12,
        capitalEfficiency: 0.045,
        allocationMultiplier: 0.95,
        confidenceWeight: 1.02,
        expectedValueWeight: 1.01,
        opportunityWeight: 1.03,
        correlationFactor: 0.92,
        diversificationFactor: 1,
        regimeAllocationFactor: 0.92,
        portfolioAction: "ALLOW",
        portfolioBlocked: false,
      },
    ];
    const kpis = aggregatePortfolioAllocationKpis(telemetry, [5, -2, 3], 10_000);
    expect(kpis.tradeCount).toBe(1);
    expect(kpis.averageAllocationMultiplier).toBe(0.95);
    expect(kpis.profitFactor).toBeGreaterThan(0);
  });
});
