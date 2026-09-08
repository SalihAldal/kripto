import { describe, expect, it } from "vitest";
import {
  computeRankingV2Score,
  computeRelativeRanks,
  computeScoreSaturation,
  extractWindowCandidateFeatures,
  percentileRank,
} from "@/src/server/scanner/ranking-engine-v2.service";
import type { MarketContext } from "@/src/types/scanner";
import type { ScannerScore } from "@/src/types/scanner";

function mockContext(symbol: string, overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    symbol,
    price: 100,
    change24h: 2,
    volume24h: 5_000_000,
    spreadPercent: 0.08,
    volatilityPercent: 1.2,
    momentumPercent: 0.5,
    buyPressure: 0.55,
    orderBookImbalance: 0.1,
    shortCandleSignal: 1,
    volumeSpikePercent: 20,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: 0.3,
      hourMomentumPercent: 0.2,
      volumeRatio20: 1.2,
      extensionFrom60mLowPercent: 1.5,
      distanceFrom60mHighPercent: 0.8,
      rsi14: 62,
    },
    ...overrides,
  };
}

function mockScore(): ScannerScore {
  return {
    symbol: "X",
    score: 85,
    confidence: 80,
    status: "QUALIFIED",
    reasons: [],
    metrics: {
      momentum: 70,
      microMomentum: 65,
      volume: 60,
      spread: 75,
      volatility: 55,
      orderBook: 50,
      pressure: 45,
      microFlow: 40,
      velocity: 35,
      candle: 30,
      pumpBoost: 20,
      pumpRiskPenalty: 10,
      fakeSpikePenalty: 5,
      positiveEvidence: 30,
      negativeEvidence: 5,
      futuresRiskPenalty: 0,
      leverageStressPenalty: 0,
      regimeTransitionPenalty: 0,
      regimeFlipPenalty: 0,
      regimeStabilityBoost: 50,
      liquidityPenalty: 0,
    },
  };
}

describe("ranking-engine-v2", () => {
  it("percentileRank returns higher rank for better values", () => {
    expect(percentileRank([1, 2, 3, 4], 4, true)).toBe(1);
    expect(percentileRank([1, 2, 3, 4], 1, true)).toBe(0);
  });

  it("relative ranks favor higher volume candidate in window", () => {
    const a = extractWindowCandidateFeatures(mockContext("A", { metadata: { volumeRatio20: 1.8 } }), mockScore());
    const b = extractWindowCandidateFeatures(mockContext("B", { metadata: { volumeRatio20: 0.6 } }), mockScore());
    const ranks = computeRelativeRanks([a, b]);
    expect(ranks.get("A")!.volumeRank).toBeGreaterThan(ranks.get("B")!.volumeRank);
  });

  it("MODEL_C scores differ from MODEL_A for micro/liquidity spread", () => {
    const features = [
      extractWindowCandidateFeatures(mockContext("HIGH", { volume24h: 8_000_000, metadata: { volumeRatio20: 1.5 } }), mockScore()),
      extractWindowCandidateFeatures(mockContext("LOW", { volume24h: 1_000_000, metadata: { volumeRatio20: 0.7 } }), mockScore()),
    ];
    const ranks = computeRelativeRanks(features);
    const high = computeRankingV2Score("MODEL_A", ranks.get("HIGH")!);
    const low = computeRankingV2Score("MODEL_A", ranks.get("LOW")!);
    expect(high).toBeGreaterThan(low);
  });

  it("score saturation detects 80+ clustering", () => {
    const stats = computeScoreSaturation([82, 84, 86, 88, 90, 91, 93]);
    expect(stats.count80Plus).toBe(7);
    expect(stats.stddev).toBeLessThan(5);
  });
});
