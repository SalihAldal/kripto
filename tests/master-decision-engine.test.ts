import { describe, expect, it } from "vitest";
import type { ExpertOpinionResult } from "../src/server/decision-engine/decision-engine.types";
import {
  computeConsensusMetrics,
  mapMasterToLegacy,
  resolveEffectiveTradingDecision,
  resolveMasterDecision,
  TRADING_DECISION_POLICY,
} from "../src/server/decision-engine/conflict-detection.service";

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

describe("master-decision-engine / trading decision calibration", () => {
  it("maps master WAIT to NO_TRADE in legacy mapping (baseline)", () => {
    expect(mapMasterToLegacy("WAIT")).toBe("NO_TRADE");
  });

  it("preserves hybrid BUY when master defers with WAIT and no bearish conflict", () => {
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
    const conflicts: [] = [];
    const metrics = computeConsensusMetrics(opinions, conflicts);
    const masterDecision = resolveMasterDecision({ matrix, metrics, opinions, conflicts });

    expect(masterDecision).toBe("WAIT");

    const effective = resolveEffectiveTradingDecision({
      masterDecision,
      hybridDecision: "BUY",
      hybridRejected: false,
      hybridConfidence: 68,
      metrics,
      opinions,
    });

    expect(effective.preservedHybridBuy).toBe(true);
    expect(effective.legacyDecision).toBe("BUY");
    expect(effective.preservationReason).toContain("Hybrid BUY preserved");
  });

  it("does not preserve hybrid BUY when master hard-rejects with bearish majority", () => {
    const opinions = [
      expert("MARKET", "SELL", 35),
      expert("MOMENTUM", "SELL", 32),
      expert("VOLUME", "WEAK_SELL", 40),
      expert("LIQUIDITY", "WEAK_BUY", 48),
      expert("RISK", "WEAK_BUY", 50),
      expert("NEWS", "NO_OPINION", 0),
      expert("EXECUTION", "WEAK_BUY", 45),
      expert("LEARNING", "NO_OPINION", 0),
    ];
    const matrix = {
      market: 35,
      momentum: 32,
      volume: 40,
      liquidity: 48,
      risk: 50,
      news: 0,
      execution: 45,
      learning: 0,
    };
    const conflicts: [] = [];
    const metrics = computeConsensusMetrics(opinions, conflicts);
    const masterDecision = resolveMasterDecision({ matrix, metrics, opinions, conflicts });

    const effective = resolveEffectiveTradingDecision({
      masterDecision,
      hybridDecision: "BUY",
      hybridRejected: false,
      hybridConfidence: 72,
      metrics,
      opinions,
    });

    expect(effective.preservedHybridBuy).toBe(false);
    expect(effective.legacyDecision).not.toBe("BUY");
  });

  it("exports stable trading decision policy constants", () => {
    expect(TRADING_DECISION_POLICY.preserveHybridBuyOnMasterDefer).toBe(true);
    expect(TRADING_DECISION_POLICY.minHybridConfidenceToPreserve).toBe(65);
  });
});
