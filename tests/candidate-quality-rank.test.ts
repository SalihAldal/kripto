import { describe, expect, it } from "vitest";
import {
  computeCandidateQualityRankAdjustment,
  computeEvidenceAdjustedRankingScore,
} from "@/src/server/scanner/candidate-quality-rank.service";
import type { MarketContext } from "@/src/types/scanner";

function baseContext(overrides: Partial<MarketContext> & { metadata?: Record<string, unknown> } = {}): MarketContext {
  return {
    symbol: "BTCTRY",
    lastPrice: 100,
    change24h: 1,
    volume24h: 2_000_000,
    volumeSpikePercent: 20,
    spreadPercent: 0.06,
    volatilityPercent: 0.8,
    momentumPercent: 0.2,
    orderBookImbalance: 0.1,
    buyPressure: 0.55,
    shortCandleSignal: 1,
    fakeSpikeScore: 0.5,
    pumpIntensity: 30,
    pumpRisk: 20,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: 0.1,
      hourMomentumPercent: 0.15,
      extensionFrom60mLowPercent: 1.2,
      distanceFrom60mHighPercent: 1.5,
      volumeRatio20: 1.3,
      topGainerPriorityScore: 0,
      ...(overrides.metadata ?? {}),
    },
    ...overrides,
  };
}

describe("candidate quality rank", () => {
  it("penalizes overextended late-entry profile", () => {
    const ctx = baseContext({
      metadata: {
        shortMomentumPercent: 0.35,
        hourMomentumPercent: 0.05,
        extensionFrom60mLowPercent: 4.5,
        distanceFrom60mHighPercent: 0.2,
        volumeRatio20: 2.8,
      },
      volumeSpikePercent: 120,
    });
    const adj = computeCandidateQualityRankAdjustment(ctx);
    expect(adj.totalAdjustment).toBeLessThan(0);
    expect(adj.overextensionPenalty).toBeLessThan(0);
  });

  it("boosts moderate volume persistence profile", () => {
    const ctx = baseContext({
      metadata: {
        shortMomentumPercent: 0.08,
        hourMomentumPercent: 0.12,
        extensionFrom60mLowPercent: 1.0,
        distanceFrom60mHighPercent: 1.2,
        volumeRatio20: 1.35,
      },
      volumeSpikePercent: 25,
    });
    const adj = computeCandidateQualityRankAdjustment(ctx);
    expect(adj.volumePersistenceBoost).toBeGreaterThan(0);
  });

  it("evidence-adjusted ranking score applies breakdown on base score", () => {
    const good = computeEvidenceAdjustedRankingScore({ baseScore: 60, context: baseContext() });
    const bad = computeEvidenceAdjustedRankingScore({
      baseScore: 60,
      context: baseContext({
        metadata: {
          shortMomentumPercent: 0.4,
          hourMomentumPercent: 0.02,
          extensionFrom60mLowPercent: 5,
          distanceFrom60mHighPercent: 0.1,
          volumeRatio20: 2.5,
        },
        volumeSpikePercent: 150,
      }),
    });
    expect(good.rankingScore).toBeGreaterThan(bad.rankingScore);
  });
});
