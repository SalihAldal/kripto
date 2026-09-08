import { describe, expect, it } from "vitest";
import {
  buildDiversifiedShortlist,
  evaluateAllSetupFamilies,
  SETUP_FAMILY_NAMES,
} from "@/src/server/strategy-architecture/setup-family-registry.service";
import type { MarketContext } from "@/src/types/scanner";
import type { KlineItem } from "@/src/types/exchange";

function klines(n = 130, price = 100): KlineItem[] {
  return Array.from({ length: n }, (_, i) => ({
    openTime: i * 60_000,
    closeTime: i * 60_000 + 59_999,
    open: price + i * 0.01,
    high: price + i * 0.02 + 0.4,
    low: price + i * 0.01 - 0.2,
    close: price + i * 0.015,
    volume: 1200 + i * 3,
  }));
}

function ctx(): MarketContext {
  return {
    symbol: "ETHTRY",
    lastPrice: 101,
    change24h: 2,
    volume24h: 6_000_000,
    spreadPercent: 0.07,
    volatilityPercent: 0.9,
    momentumPercent: 0.4,
    orderBookImbalance: 0.1,
    buyPressure: 0.55,
    shortCandleSignal: 2,
    fakeSpikeScore: 0.2,
    pumpIntensity: 38,
    pumpRisk: 28,
    volumeSpikePercent: 45,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: 0.16,
      hourMomentumPercent: 0.22,
      volumeRatio20: 1.12,
      distanceFrom60mHighPercent: 1.1,
      extensionFrom60mLowPercent: 2.4,
      rsi14: 61,
      atrPercent: 0.9,
      marketRegime: "TREND_UP",
    },
  };
}

describe("setup-family-registry", () => {
  it("evaluates at least one setup for momentum context", () => {
    const hits = evaluateAllSetupFamilies({ context: ctx(), klines: klines(), idx: 120 });
    expect(hits.length).toBeGreaterThan(0);
    expect(SETUP_FAMILY_NAMES).toContain(hits[0].family);
  });

  it("diversified shortlist avoids duplicate symbols", () => {
    const hit = { family: "BREAKOUT_CONTINUATION" as const, setupConfidence: 70, tier: "HIGH" as const, reasons: [] };
    const list = buildDiversifiedShortlist([
      { symbol: "A", hit },
      { symbol: "A", hit: { ...hit, setupConfidence: 60 } },
      { symbol: "B", hit: { ...hit, family: "TREND_PULLBACK" } },
    ]);
    expect(list.filter((r) => r.symbol === "A").length).toBe(1);
  });
});
