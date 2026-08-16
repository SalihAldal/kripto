import { describe, expect, it } from "vitest";
import { evaluateRankingGate, resolveRankingThreshold } from "../src/server/scanner/candidate-ranking.service";
import {
  classifyInstitutionalRegime,
  evaluateStrategyRegimeAlignment,
  normalizeMarketRegimeLabel,
  resolveRegimePipelinePolicy,
} from "../src/server/scanner/regime-intelligence.service";
import { shouldRejectHighRiskLowConfidenceEntry } from "../src/server/execution/profit-thresholds";

describe("regime-intelligence", () => {
  it("normalizes simulation regimes to scanner taxonomy", () => {
    expect(normalizeMarketRegimeLabel("trending")).toBe("WEAK_BULLISH_TREND");
    expect(normalizeMarketRegimeLabel("volatile")).toBe("HIGH_VOLATILITY_CHAOS");
    expect(normalizeMarketRegimeLabel("STRONG_BULLISH_TREND")).toBe("STRONG_BULLISH_TREND");
  });

  it("classifies institutional regime classes from market evidence", () => {
    const classes = classifyInstitutionalRegime({
      marketRegime: "volatile",
      volatilityPercent: 3.1,
      liquidity24h: 8_000_000,
      minLiquidityThreshold: 5_000_000,
    });
    expect(classes).toContain("HIGH_VOLATILITY");
    expect(classes).not.toContain("LOW_LIQUIDITY");
  });

  it("uses regime entryThresholdScore for ranking threshold", () => {
    const strongBull = resolveRankingThreshold({
      confidencePercent: 60,
      riskScore: 40,
      marketRegime: "STRONG_BULLISH_TREND",
    });
    const chaos = resolveRankingThreshold({
      confidencePercent: 60,
      riskScore: 40,
      marketRegime: "HIGH_VOLATILITY_CHAOS",
    });
    expect(strongBull).toBeLessThan(chaos);
  });

  it("detects strategy-regime misalignment", () => {
    const policy = resolveRegimePipelinePolicy({ marketRegime: "LOW_VOLATILITY_CALM" });
    const aligned = evaluateStrategyRegimeAlignment({
      strategy: "mean_reversion",
      allowedStrategyTypes: policy.allowedStrategyTypes,
    });
    const misaligned = evaluateStrategyRegimeAlignment({
      strategy: "breakout_follow",
      allowedStrategyTypes: policy.allowedStrategyTypes,
    });
    expect(aligned.aligned).toBe(true);
    expect(misaligned.aligned).toBe(false);
  });

  it("tightens entry quality in high volatility regimes", () => {
    const calm = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: 80,
      aiRiskScore: 74,
      marketRegime: "LOW_VOLATILITY_CALM",
    });
    const chaos = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: 80,
      aiRiskScore: 74,
      marketRegime: "HIGH_VOLATILITY_CHAOS",
    });
    expect(calm.reject).toBe(false);
    expect(chaos.reject).toBe(true);
  });

  it("passes ranking gate with regime-aware threshold relief", () => {
    const gate = evaluateRankingGate({
      rankingScore: 50,
      confidencePercent: 72,
      riskScore: 35,
      marketRegime: "STRONG_BULLISH_TREND",
    });
    expect(gate.pass).toBe(true);
  });
});
