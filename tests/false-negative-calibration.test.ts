import { describe, expect, it } from "vitest";
import { evaluateRankingGate, RANKING_LOGIC_POLICY, resolveRankingThreshold } from "../src/server/scanner/candidate-ranking.service";
import { boundMaxRiskPerTrade, RISK_GATE_POLICY } from "../src/server/risk/risk-evaluation.service";

describe("false-negative calibration", () => {
  const flatGateInput = { entryThresholdScore: RANKING_LOGIC_POLICY.baseRankingThreshold } as const;

  it("relaxes ranking threshold for high-confidence low-risk setups", () => {
    expect(resolveRankingThreshold({ confidencePercent: 70, riskScore: 40, ...flatGateInput })).toBe(48);
    expect(resolveRankingThreshold({ confidencePercent: 55, riskScore: 40, ...flatGateInput })).toBe(55);
    const gate = evaluateRankingGate({
      rankingScore: 50,
      confidencePercent: 72,
      riskScore: 35,
      ...flatGateInput,
    });
    expect(gate.pass).toBe(true);
    expect(gate.threshold).toBe(48);
  });

  it("keeps strict ranking threshold without confidence relief", () => {
    const gate = evaluateRankingGate({
      rankingScore: 50,
      confidencePercent: 60,
      riskScore: 35,
      ...flatGateInput,
    });
    expect(gate.pass).toBe(false);
    expect(gate.threshold).toBe(55);
  });

  it("uses regime entry threshold when market regime is supplied", () => {
    expect(
      resolveRankingThreshold({
        confidencePercent: 60,
        riskScore: 40,
        marketRegime: "RANGE_SIDEWAYS",
      }),
    ).toBe(68);
    expect(
      resolveRankingThreshold({
        confidencePercent: 72,
        riskScore: 35,
        marketRegime: "LOW_VOLATILITY_CALM",
      }),
    ).toBe(48);
  });

  it("allows small risk-per-trade bump for elite confidence setups only", () => {
    const base = 1;
    expect(
      boundMaxRiskPerTrade(base, { confidencePercent: 75, riskPerTradePercent: 1.12, aiRiskScore: 40 }),
    ).toBe(base + RISK_GATE_POLICY.maxRiskPerTradeBumpPercent);
    expect(
      boundMaxRiskPerTrade(base, { confidencePercent: 75, riskPerTradePercent: 1.12, aiRiskScore: 40 }) >= 1.12,
    ).toBe(true);
    expect(
      boundMaxRiskPerTrade(base, { confidencePercent: 60, riskPerTradePercent: 1.12, aiRiskScore: 40 }),
    ).toBe(base);
    expect(
      boundMaxRiskPerTrade(base, { confidencePercent: 75, riskPerTradePercent: 1.25, aiRiskScore: 40 }),
    ).toBe(base);
  });
});
