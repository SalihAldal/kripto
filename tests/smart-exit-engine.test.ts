import { describe, expect, it } from "vitest";
import { evaluateSmartExitEngine } from "../src/server/execution/smart-exit-engine.service";

describe("smart-exit-engine", () => {
  it("güçlü momentumda TP'yi erken kesmez", () => {
    const state = {
      lastAdaptiveTp: 102,
      peakProfitPercent: 1.4,
      lastRegime: "WEAK_BULLISH_TREND",
    };
    const result = evaluateSmartExitEngine({
      side: "LONG",
      entryPrice: 100,
      markPrice: 101.2,
      initialTp: 102,
      state,
      shortMomentumPercent: 0.35,
      shortFlowImbalance: 0.08,
      shortCandleSignal: 1,
      spreadPercent: 0.08,
      volatilityPercent: 1.6,
      volume24h: 8_000_000,
      marketRegime: "WEAK_BULLISH_TREND",
      reverseSignal: false,
    });
    expect(result.adaptiveTp).toBeGreaterThanOrEqual(result.initialTp);
    expect(result.earlyExitTrigger).toBe("NONE");
  });

  it("momentum ölünce erken çıkış üretir", () => {
    const state = {
      lastAdaptiveTp: 102,
      peakProfitPercent: 1.9,
      lastRegime: "STRONG_BULLISH_TREND",
    };
    const result = evaluateSmartExitEngine({
      side: "LONG",
      entryPrice: 100,
      markPrice: 100.8,
      initialTp: 102,
      state,
      shortMomentumPercent: -0.28,
      shortFlowImbalance: -0.07,
      shortCandleSignal: -2,
      spreadPercent: 0.09,
      volatilityPercent: 2.1,
      volume24h: 3_000_000,
      marketRegime: "WEAK_BULLISH_TREND",
      reverseSignal: false,
    });
    expect(result.earlyExitTrigger === "MOMENTUM_FADE" || result.earlyExitTrigger === "REVERSAL_CANDLE").toBe(true);
    expect(result.closeReason).toBe("MOMENTUM_FADE");
    expect(result.exitConfidence).toBeGreaterThan(50);
  });

  it("ters sinyalde reverse exit üretir", () => {
    const state = {
      lastAdaptiveTp: 98.2,
      peakProfitPercent: 1.1,
      lastRegime: "STRONG_BEARISH_TREND",
    };
    const result = evaluateSmartExitEngine({
      side: "SHORT",
      entryPrice: 100,
      markPrice: 99.1,
      initialTp: 98.4,
      state,
      shortMomentumPercent: 0.12,
      shortFlowImbalance: 0.04,
      shortCandleSignal: 2,
      spreadPercent: 0.1,
      volatilityPercent: 1.8,
      volume24h: 6_000_000,
      marketRegime: "RANGE_SIDEWAYS",
      reverseSignal: true,
    });
    expect(result.earlyExitTrigger).toBe("REVERSE_SIGNAL");
    expect(result.closeReason).toBe("REVERSE_SIGNAL");
  });
});
