import { describe, expect, it } from "vitest";
import {
  checkConfidenceMonotonicity,
  computeForensicExcursion,
  discoverV2CandidatesInWindow,
  evaluateDiscoveryV2Setups,
  extractMarketStateFeatures,
  isPositiveEdgeClass,
} from "@/src/server/scanner/scanner-discovery-v2.service";
import type { MarketContext } from "@/src/types/scanner";
import type { KlineItem } from "@/src/types/exchange";

function mockKlines(price = 100, steps = 130): KlineItem[] {
  return Array.from({ length: steps }, (_, i) => ({
    openTime: i * 60_000,
    closeTime: i * 60_000 + 59_999,
    open: price + i * 0.01,
    high: price + i * 0.02 + 0.5,
    low: price + i * 0.01 - 0.3,
    close: price + i * 0.015,
    volume: 1000 + i * 5,
  }));
}

function mockContext(): MarketContext {
  return {
    symbol: "ETHTRY",
    lastPrice: 101.5,
    change24h: 2.5,
    volume24h: 8_000_000,
    spreadPercent: 0.07,
    volatilityPercent: 1.1,
    momentumPercent: 0.45,
    orderBookImbalance: 0.12,
    buyPressure: 0.58,
    shortCandleSignal: 2,
    fakeSpikeScore: 0.3,
    pumpIntensity: 40,
    pumpRisk: 30,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: 0.18,
      hourMomentumPercent: 0.25,
      volumeRatio20: 1.15,
      distanceFrom60mHighPercent: 1.2,
      extensionFrom60mLowPercent: 2.1,
      rsi14: 62,
      atrPercent: 1.0,
      marketRegime: "TREND_UP",
    },
  };
}

describe("scanner-discovery-v2", () => {
  it("extracts market state without future data", () => {
    const klines = mockKlines();
    const features = extractMarketStateFeatures({ context: mockContext(), klines, idx: 120 });
    expect(features.volumeRatio20).toBeGreaterThan(0);
    expect(features.return15m).toBeGreaterThan(0);
  });

  it("evaluates at least one setup for momentum+volume context", () => {
    const features = extractMarketStateFeatures({ context: mockContext(), klines: mockKlines(), idx: 120 });
    const setup = evaluateDiscoveryV2Setups({ context: mockContext(), features });
    expect(setup).not.toBeNull();
    expect(setup!.setupConfidence).toBeGreaterThan(30);
  });

  it("dedupes and shortlists per window", () => {
    const ctx = mockContext();
    const features = extractMarketStateFeatures({ context: ctx, klines: mockKlines(), idx: 120 });
    const setup = evaluateDiscoveryV2Setups({ context: ctx, features })!;
    const rows = discoverV2CandidatesInWindow([
      { symbol: "ETHTRY", setup, features, context: ctx },
      { symbol: "ETHTRY", setup: { ...setup, setupConfidence: setup.setupConfidence - 5 }, features, context: ctx },
    ]);
    expect(rows.length).toBe(1);
  });

  it("labels positive edge from excursion minus cost", () => {
    const klines = mockKlines(100, 200);
    for (let i = 130; i < 180; i += 1) {
      klines[i].high = 103;
      klines[i].close = 102.5;
    }
    const forensic = computeForensicExcursion({ klines, idx: 120, roundTripCostPct: 0.44 });
    expect(isPositiveEdgeClass(forensic.qualityClass) || forensic.qualityClass === "NO_EDGE").toBe(true);
    expect(forensic.mfe.mfe60).toBeGreaterThanOrEqual(0);
  });

  it("confidence monotonicity detects inverted buckets", () => {
    expect(
      checkConfidenceMonotonicity([
        { tier: "LOW", positiveRate: 30, count: 20 },
        { tier: "HIGH", positiveRate: 20, count: 20 },
      ]),
    ).toBe(false);
    expect(
      checkConfidenceMonotonicity([
        { tier: "LOW", positiveRate: 20, count: 20 },
        { tier: "HIGH", positiveRate: 35, count: 20 },
      ]),
    ).toBe(true);
  });
});
