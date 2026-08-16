import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readMomentumTelemetry,
  resolveLowMomentumInput,
  resolveMomentumSupportive,
  resolveMomentumWeak,
  resolvePaperMomentumWaiver,
  resolveTechStrongButOthersWeak,
} from "@/src/server/ai/hybrid-momentum-gates";
import { buildHybridDecision } from "@/src/server/ai/hybrid-decision-engine";
import {
  computeConsensusMetrics,
  resolveEffectiveTradingDecision,
  resolveMasterDecision,
} from "@/src/server/decision-engine/conflict-detection.service";
import { analyzeLearningExpert, analyzeMomentumExpert } from "@/src/server/decision-engine/experts/domain-experts";
import {
  scoreMomentumImpulse,
  hasMomentumExpertTelemetry,
} from "@/src/server/decision-engine/experts/momentum-expert.utils";
import type { ExpertOpinionResult } from "@/src/server/decision-engine/decision-engine.types";
import type { AIAnalysisInput, AIModelOutput, AIProviderResult } from "@/src/types/ai";

function expert(
  expertType: ExpertOpinionResult["expertType"],
  opinion: ExpertOpinionResult["opinion"],
  score: number,
): ExpertOpinionResult {
  return {
    expertType,
    opinion,
    confidence: score,
    score,
    summary: "test",
    positiveFactors: [],
    negativeFactors: [],
    topRisks: [],
  };
}

function providerRow(providerId: string, output: AIModelOutput): AIProviderResult {
  return {
    providerId,
    providerName: providerId,
    ok: true,
    output,
    latencyMs: 12,
  };
}

function baseInput(overrides?: Partial<AIAnalysisInput>): AIAnalysisInput {
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
    orderBookSummary: { bestBid: 109.9, bestAsk: 110.1, bidDepth: 520_000, askDepth: 470_000 },
    recentTradesSummary: { buyVolume: 220_000, sellVolume: 180_000, buySellRatio: 1.22 },
    spread: 0.08,
    volatility: 1.4,
    marketSignals: {
      change24h: 2.1,
      change5m: 0.35,
      change15m: 0.8,
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
    strategyParams: { tradeQualityScore: 86, executionMode: "paper" },
    ...overrides,
  };
}

describe("P0 TDI buy bottleneck gates", () => {
  it("does not treat missing momentum telemetry as low momentum", () => {
    expect(readMomentumTelemetry(undefined).hasTelemetry).toBe(false);
    expect(resolveLowMomentumInput(undefined)).toBe(false);
    expect(
      resolveLowMomentumInput({
        shortMomentumPercent: undefined,
        shortFlowImbalance: undefined,
      }),
    ).toBe(false);
  });

  it("flags low momentum only when telemetry exists and both signals are weak", () => {
    expect(
      resolveLowMomentumInput({
        shortMomentumPercent: 0.02,
        shortFlowImbalance: 0.01,
      }),
    ).toBe(true);
    expect(
      resolveLowMomentumInput({
        shortMomentumPercent: 0.42,
        shortFlowImbalance: 0.18,
      }),
    ).toBe(false);
  });

  it("avoids duplicate paper downgrade via techStrongButOthersWeak", () => {
    const waiver = resolvePaperMomentumWaiver({
      paperRelaxed: true,
      sentimentScore: 40,
      newsComplex: false,
    });
    expect(waiver).toBe(true);
    expect(
      resolveTechStrongButOthersWeak({
        technicalStrong: true,
        riskVeto: false,
        allowPumpOverride: false,
        momentumWeak: true,
        qualityWeak: false,
        paperMomentumWaiver: waiver,
      }),
    ).toBe(false);
  });

  it("normalizes momentum impulse for percent-point shortMomentum values", () => {
    const input = baseInput({
      marketSignals: {
        change24h: 3,
        change5m: 0.8,
        change15m: 1.2,
        shortMomentumPercent: 1.8,
        shortFlowImbalance: 0.12,
      },
    });
    expect(scoreMomentumImpulse(input)).toBeGreaterThan(45);
    const expert = analyzeMomentumExpert(input);
    expect(expert.opinion).not.toBe("NO_OPINION");
    expect(expert.score).toBeGreaterThan(45);
  });

  it("returns NO_OPINION for momentum expert when telemetry window is insufficient", () => {
    const input = baseInput({ klines: baseInput().klines.slice(0, 4) });
    expect(hasMomentumExpertTelemetry(input)).toBe(false);
    const expert = analyzeMomentumExpert(input);
    expect(expert.opinion).toBe("NO_OPINION");
    expect(expert.score).toBe(50);
  });

  it("learning NO_OPINION stays neutral and does not pull actionable consensus down artificially", () => {
    const learning = analyzeLearningExpert(baseInput());
    expect(learning.opinion).toBe("NO_OPINION");
    const opinions = [
      expert("MARKET", "WEAK_BUY", 58),
      expert("MOMENTUM", "BUY", 64),
      expert("VOLUME", "WEAK_BUY", 54),
      expert("LIQUIDITY", "BUY", 60),
      expert("RISK", "WEAK_BUY", 56),
      expert("NEWS", "WEAK_BUY", 48),
      expert("EXECUTION", "WEAK_BUY", 50),
      learning,
    ];
    const metrics = computeConsensusMetrics(opinions, []);
    expect(metrics.consensusScore).toBeGreaterThan(52);
  });

  it("preserves hybrid BUY using finalConsensusConfidence when master defers", () => {
    const opinions = [
      expert("MARKET", "WEAK_BUY", 58),
      expert("MOMENTUM", "BUY", 62),
      expert("VOLUME", "WEAK_BUY", 54),
      expert("LIQUIDITY", "BUY", 60),
      expert("RISK", "WEAK_BUY", 56),
      expert("NEWS", "WEAK_BUY", 48),
      expert("EXECUTION", "WEAK_BUY", 50),
      expert("LEARNING", "WEAK_BUY", 46),
    ];
    const matrix = {
      market: 58,
      momentum: 62,
      volume: 54,
      liquidity: 60,
      risk: 56,
      news: 48,
      execution: 50,
      learning: 46,
    };
    const metrics = computeConsensusMetrics(opinions, []);
    const masterDecision = resolveMasterDecision({ matrix, metrics, opinions, conflicts: [] });
    expect(masterDecision).toBe("WAIT");
    const effective = resolveEffectiveTradingDecision({
      masterDecision,
      hybridDecision: "BUY",
      hybridRejected: false,
      hybridConfidence: 68,
      metrics,
      opinions,
    });
    expect(effective.legacyDecision).toBe("BUY");
  });

  it("strong technical + strong momentum can still reach BUY in hybrid path", () => {
    const input = baseInput({
      marketSignals: {
        change24h: 4.2,
        change5m: 1.1,
        change15m: 2.4,
        shortMomentumPercent: 1.6,
        shortFlowImbalance: 0.22,
        tradeVelocity: 2.4,
        socialSentimentScore: 68,
        newsSentiment: "POSITIVE",
      },
    });
    const technical = providerRow("provider-1", {
      decision: "BUY",
      confidence: 94,
      targetPrice: 114,
      stopPrice: 109.2,
      estimatedDurationSec: 420,
      reasoningShort: "strong",
      riskScore: 28,
      metadata: {},
    });
    const sentiment = providerRow("provider-2", {
      decision: "BUY",
      confidence: 90,
      targetPrice: 113.8,
      stopPrice: 109.2,
      estimatedDurationSec: 360,
      reasoningShort: "strong",
      riskScore: 32,
      metadata: { tradeSupportive: true },
    });
    const risk = providerRow("provider-3", {
      decision: "BUY",
      confidence: 92,
      targetPrice: 113.5,
      stopPrice: 109.3,
      estimatedDurationSec: 300,
      reasoningShort: "ok",
      riskScore: 22,
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
  });

  it("strong technical + weak momentum remains HOLD/WATCHLIST without duplicate downgrade", () => {
    const input = baseInput({
      marketSignals: {
        change24h: 1.2,
        change5m: 0.05,
        change15m: 0.1,
        shortMomentumPercent: 0.03,
        shortFlowImbalance: 0.01,
        tradeVelocity: 0.4,
        socialSentimentScore: 48,
        newsSentiment: "NEUTRAL",
      },
      strategyParams: { tradeQualityScore: 71, executionMode: "paper" },
    });
    const technical = providerRow("provider-1", {
      decision: "BUY",
      confidence: 88,
      targetPrice: 112,
      stopPrice: 109.2,
      estimatedDurationSec: 420,
      reasoningShort: "teknik",
      riskScore: 30,
      metadata: {},
    });
    const sentiment = providerRow("provider-2", {
      decision: "HOLD",
      confidence: 44,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 200,
      reasoningShort: "zayif",
      riskScore: 52,
      metadata: { tradeSupportive: false },
    });
    const risk = providerRow("provider-3", {
      decision: "BUY",
      confidence: 80,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 220,
      reasoningShort: "ok",
      riskScore: 34,
      metadata: {},
    });
    const result = buildHybridDecision({
      analysisInput: input,
      technicalResults: [technical],
      momentumResults: [sentiment],
      riskResults: [risk],
      allOutputs: [technical, sentiment, risk],
    });
    expect(result.finalDecision).toBe("HOLD");
    expect(result.finalConsensusDecision).toBe("WATCHLIST");
  });

  it("canonical 46-round fixture records zero runtime BUY with duplicate momentum/tech blockers dominant", () => {
    const root = path.join(process.cwd(), "artifacts", "forensics", "cmstltuqn0007un9ksbk3xn9c", "rounds");
    if (!fs.existsSync(root)) return;
    let total = 0;
    let approved = 0;
    let hybridBuy = 0;
    let duplicateMomentumTech = 0;
    for (const roundDir of fs.readdirSync(root).filter((name) => /^\d+$/.test(name))) {
      const filePath = path.join(root, roundDir, "tdi-decisions.json");
      if (!fs.existsSync(filePath)) continue;
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
        records?: Array<{ verdict?: string; hybridDecision?: string; consensusScore?: number; reasonDetail?: string; candidateId?: string }>;
      };
      for (const row of payload.records ?? []) {
        total += 1;
        if (row.verdict === "APPROVED") approved += 1;
        if (row.hybridDecision === "BUY") hybridBuy += 1;
        if (
          row.candidateId?.startsWith("hybrid:") &&
          (row.consensusScore ?? 0) >= 55 &&
          row.reasonDetail?.includes("Momentum guven vermiyor") &&
          row.reasonDetail?.includes("Teknik guclu ama diger AI destegi zayif")
        ) {
          duplicateMomentumTech += 1;
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(approved).toBe(0);
    expect(hybridBuy).toBe(0);
    expect(duplicateMomentumTech).toBeGreaterThan(1000);
  });
});
