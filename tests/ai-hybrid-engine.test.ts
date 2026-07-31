import { describe, expect, it } from "vitest";
import { buildHybridDecision } from "@/src/server/ai/hybrid-decision-engine";
import type { AIAnalysisInput, AIModelOutput, AIProviderResult } from "@/src/types/ai";

function providerRow(providerId: string, output: AIModelOutput): AIProviderResult {
  return {
    providerId,
    providerName: providerId,
    ok: true,
    output,
    latencyMs: 15,
  };
}

function createMockInput(overrides?: Partial<AIAnalysisInput>): AIAnalysisInput {
  const now = Date.now();
  const klines = Array.from({ length: 80 }).map((_, idx) => {
    const base = 100 + idx * 0.12;
    return {
      open: base,
      high: base * 1.002,
      low: base * 0.998,
      close: base * 1.001,
      volume: 120 + idx,
      openTime: now - (80 - idx) * 60_000,
      closeTime: now - (79 - idx) * 60_000,
    };
  });
  return {
    symbol: "BTCTRY",
    lastPrice: 110,
    klines,
    volume24h: 2_400_000,
    orderBookSummary: {
      bestBid: 109.9,
      bestAsk: 110.1,
      bidDepth: 520_000,
      askDepth: 470_000,
    },
    recentTradesSummary: {
      buyVolume: 220_000,
      sellVolume: 180_000,
      buySellRatio: 1.22,
    },
    spread: 0.08,
    volatility: 1.4,
    marketSignals: {
      change24h: 2.1,
      shortMomentumPercent: 0.42,
      shortFlowImbalance: 0.18,
      tradeVelocity: 1.8,
      btcDominanceBias: 0.1,
      socialSentimentScore: 62,
      newsSentiment: "POSITIVE",
    },
    multiTimeframe: {
      entry: {
        m1: { direction: "BULLISH", strength: 61, slopePercent: 0.34, lastClose: 110.02 },
        m5: { direction: "BULLISH", strength: 64, slopePercent: 0.46, lastClose: 109.95 },
      },
      trend: {
        m15: { direction: "BULLISH", strength: 72, slopePercent: 1.24, lastClose: 109.6 },
        h1: { direction: "BULLISH", strength: 77, slopePercent: 2.3, lastClose: 108.9 },
      },
      macro: {
        h4: { direction: "BULLISH", strength: 79, slopePercent: 3.8, lastClose: 107.5 },
        d1: { direction: "BULLISH", strength: 83, slopePercent: 5.7, lastClose: 104.2 },
      },
      dominantTrend: "BULLISH",
      conflict: false,
      trendAligned: true,
      entrySuitable: true,
      reason: "MTF uyumlu",
    },
    ...overrides,
  };
}

describe("hybrid decision engine", () => {
  it("guctu sinyalde BUY consensus uretir", () => {
    const input = createMockInput({
      strategyParams: {
        tradeQualityScore: 86,
      },
    });
    const technical = providerRow("provider-1", {
      decision: "BUY",
      confidence: 96,
      targetPrice: 114,
      stopPrice: 109.2,
      estimatedDurationSec: 420,
      reasoningShort: "Trend ve hacim destekli",
      riskScore: 32,
      metadata: {},
    });
    const sentiment = providerRow("provider-2", {
      decision: "BUY",
      confidence: 93,
      targetPrice: 113.6,
      stopPrice: 109.2,
      estimatedDurationSec: 360,
      reasoningShort: "Momentum pozitif",
      riskScore: 36,
      metadata: {},
    });
    const risk = providerRow("provider-3", {
      decision: "BUY",
      confidence: 95,
      targetPrice: 113.2,
      stopPrice: 109.3,
      estimatedDurationSec: 300,
      reasoningShort: "Risk kabul edilebilir",
      riskScore: 18,
      metadata: {},
    });

    const result = buildHybridDecision({
      analysisInput: input,
      technicalResults: [technical],
      momentumResults: [sentiment],
      riskResults: [risk],
      allOutputs: [technical, sentiment, risk],
    });

    expect(result.finalDecision).toBe("BUY");
    expect(result.finalConsensusDecision).toBe("BUY");
    expect(result.rejected).toBe(false);
    expect(result.decisionPayload?.openTrade).toBe(true);
    expect(result.decisionPayload?.consensusEngine?.finalDecision).toBe("BUY");
    expect(result.decisionPayload?.selfCriticReview?.finalApprovalOrDowngrade).toBe("APPROVED");
    expect((result.roleScores ?? []).length).toBe(3);
  });

  it("risk veto durumunda NO_TRADE doner", () => {
    const input = createMockInput({
      spread: 0.34,
      volatility: 4.6,
      volume24h: 120_000,
    });
    const technical = providerRow("provider-1", {
      decision: "BUY",
      confidence: 79,
      targetPrice: 113,
      stopPrice: 108,
      estimatedDurationSec: 380,
      reasoningShort: "Teknik olarak olumlu",
      riskScore: 44,
      metadata: {},
    });
    const sentiment = providerRow("provider-2", {
      decision: "BUY",
      confidence: 77,
      targetPrice: 112,
      stopPrice: 108,
      estimatedDurationSec: 390,
      reasoningShort: "Duyarlilik iyi",
      riskScore: 40,
      metadata: {},
    });
    const risk = providerRow("provider-3", {
      decision: "NO_TRADE",
      confidence: 30,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 120,
      reasoningShort: "Asiri riskli",
      riskScore: 92,
      metadata: {},
    });
    const result = buildHybridDecision({
      analysisInput: input,
      technicalResults: [technical],
      momentumResults: [sentiment],
      riskResults: [risk],
      allOutputs: [technical, sentiment, risk],
    });

    expect(result.finalDecision).toBe("NO_TRADE");
    expect(result.finalConsensusDecision).toBe("REJECT");
    expect(result.rejected).toBe(true);
    expect(result.rejectReason).toContain("Risk");
    expect(result.decisionPayload?.consensusEngine?.vetoStatus.vetoed).toBe(true);
  });

  it("no-trade mode nedenlerini ve engelleyen AI listesini doldurur", () => {
    const input = createMockInput({
      volume24h: 120_000,
      volatility: 4.1,
      marketRegime: {
        mode: "HIGH_VOLATILITY_CHAOS",
        reason: "chaotic",
        selectedStrategy: "VOLATILITY_DEFENSIVE",
        openTradeAllowed: false,
        tpMultiplier: 0.9,
        slMultiplier: 1.1,
        riskMultiplier: 0.7,
      },
      multiTimeframe: {
        entry: {
          m1: { direction: "BULLISH", strength: 48, slopePercent: 0.2, lastClose: 110.1 },
          m5: { direction: "BEARISH", strength: 51, slopePercent: -0.25, lastClose: 109.9 },
        },
        trend: {
          m15: { direction: "RANGE", strength: 44, slopePercent: 0.1, lastClose: 109.8 },
          h1: { direction: "BEARISH", strength: 55, slopePercent: -0.6, lastClose: 109.2 },
        },
        macro: {
          h4: { direction: "RANGE", strength: 40, slopePercent: 0.05, lastClose: 109 },
          d1: { direction: "RANGE", strength: 42, slopePercent: 0.03, lastClose: 108.8 },
        },
        dominantTrend: "RANGE",
        conflict: true,
        trendAligned: false,
        entrySuitable: false,
        reason: "cakisma",
      },
    });
    const technical = providerRow("provider-1", {
      decision: "HOLD",
      confidence: 56,
      targetPrice: 111,
      stopPrice: 108.8,
      estimatedDurationSec: 300,
      reasoningShort: "weak",
      riskScore: 52,
      metadata: {},
    });
    const sentiment = providerRow("provider-2", {
      decision: "NO_TRADE",
      confidence: 48,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 120,
      reasoningShort: "news unclear",
      riskScore: 60,
      metadata: {
        tradeSupportive: false,
        redFlags: ["news uncertain", "late move"],
      },
    });
    const risk = providerRow("provider-3", {
      decision: "NO_TRADE",
      confidence: 40,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 60,
      reasoningShort: "reject",
      riskScore: 88,
      metadata: {
        approveRejectCaution: "REJECT",
      },
    });
    const result = buildHybridDecision({
      analysisInput: input,
      technicalResults: [technical],
      momentumResults: [sentiment],
      riskResults: [risk],
      allOutputs: [technical, sentiment, risk],
    });

    expect(result.finalDecision).toBe("NO_TRADE");
    expect(result.finalConsensusDecision === "NO-TRADE" || result.finalConsensusDecision === "REJECT").toBe(true);
    expect(result.decisionPayload?.noTradeMode?.enabled).toBe(true);
    expect((result.decisionPayload?.noTradeMode?.reasonList ?? []).length).toBeGreaterThan(0);
    expect((result.decisionPayload?.noTradeMode?.blockedByAi ?? []).length).toBeGreaterThan(0);
    expect(
      result.decisionPayload?.executionReason === "no-trade-discipline-mode" ||
        result.decisionPayload?.executionReason === "regime-filtered",
    ).toBe(true);
  });

  it("teknik guclu ama momentum zayifsa WATCHLIST uretir", () => {
    const input = createMockInput({
      strategyParams: {
        tradeQualityScore: 71,
      },
    });
    const technical = providerRow("provider-1", {
      decision: "BUY",
      confidence: 90,
      targetPrice: 114,
      stopPrice: 109.2,
      estimatedDurationSec: 420,
      reasoningShort: "Teknik guclu",
      riskScore: 28,
      metadata: {},
    });
    const sentiment = providerRow("provider-2", {
      decision: "HOLD",
      confidence: 54,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 200,
      reasoningShort: "Haber net degil",
      riskScore: 52,
      metadata: {
        tradeSupportive: false,
        redFlags: ["news uncertain"],
      },
    });
    const risk = providerRow("provider-3", {
      decision: "BUY",
      confidence: 84,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 220,
      reasoningShort: "Risk kabul",
      riskScore: 30,
      metadata: {
        approveRejectCaution: "CAUTION",
      },
    });
    const result = buildHybridDecision({
      analysisInput: input,
      technicalResults: [technical],
      momentumResults: [sentiment],
      riskResults: [risk],
      allOutputs: [technical, sentiment, risk],
    });

    expect(result.finalConsensusDecision).toBe("WATCHLIST");
    expect(result.finalDecision).toBe("HOLD");
    expect(result.decisionPayload?.consensusEngine?.finalDecision).toBe("WATCHLIST");
    expect(result.decisionPayload?.executionReason).toBe("watchlist-confirmation-needed");
  });

  it("self-critic ciddi itirazda BUY kararini dusurebilir", () => {
    const input = createMockInput({
      strategyParams: {
        tradeQualityScore: 84,
      },
      spread: 0.19,
      volatility: 3,
      marketSignals: {
        change24h: 2.3,
        shortMomentumPercent: 0.21,
        shortFlowImbalance: 0.06,
        tradeVelocity: 2.1,
        btcDominanceBias: 0.1,
        socialSentimentScore: 58,
        newsSentiment: "POSITIVE",
      },
    });
    const technical = providerRow("provider-1", {
      decision: "BUY",
      confidence: 95,
      targetPrice: 112.2,
      stopPrice: 109.4,
      estimatedDurationSec: 320,
      reasoningShort: "ok",
      riskScore: 33,
      metadata: {},
    });
    const sentiment = providerRow("provider-2", {
      decision: "BUY",
      confidence: 82,
      targetPrice: 112.1,
      stopPrice: 109.4,
      estimatedDurationSec: 320,
      reasoningShort: "mixed",
      riskScore: 45,
      metadata: {
        tradeSupportive: false,
        redFlags: ["late trend", "news unclear"],
      },
    });
    const risk = providerRow("provider-3", {
      decision: "BUY",
      confidence: 84,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 220,
      reasoningShort: "medium risk",
      riskScore: 64,
      metadata: {
        approveRejectCaution: "CAUTION",
      },
    });
    const result = buildHybridDecision({
      analysisInput: input,
      technicalResults: [technical],
      momentumResults: [sentiment],
      riskResults: [risk],
      allOutputs: [technical, sentiment, risk],
    });
    if (result.finalConsensusDecision === "BUY") {
      expect(result.decisionPayload?.selfCriticReview?.overrideSuggestion).not.toBe("KEEP_BUY");
    }
    expect(result.finalConsensusDecision === "WATCHLIST" || result.finalConsensusDecision === "NO-TRADE").toBe(true);
    if (result.decisionPayload?.selfCriticReview?.overrideSuggestion !== "KEEP_BUY") {
      expect(result.decisionPayload?.selfCriticReview?.confidenceAdjusted).toBeLessThanOrEqual(
        Number(result.finalConfidence.toFixed(2)),
      );
    }
  });
});
