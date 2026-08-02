import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIDecision, AIProviderResult } from "../src/types/ai";

vi.mock("@/lib/config", () => ({
  env: {
    AI_MAX_RISK_SCORE: 75,
    AI_MIN_CONFIDENCE: 65,
    AI_STRICT_ANALYST_MODE: false,
    AI_QUALITY_PROFILE: "standard",
    AI_MIN_HEALTHY_PROVIDER_COUNT: 2,
    AI_REQUIRE_UNANIMOUS_BUY_SELL: false,
    AI_LEVERAGE_MIN_CONFIDENCE_ULTRA: 70,
    AI_ULTRA_MAX_RISK_SCORE_SPOT: 60,
    AI_ULTRA_MAX_RISK_SCORE_LEVERAGE: 55,
  },
}));

import {
  AI_CONSENSUS_POLICY,
  rejectUnsafeTrade,
  scoreTradeOpportunity,
  summarizeConsensus,
} from "../src/server/ai/consensus-engine";

function provider(
  id: string,
  decision: AIDecision,
  confidence: number,
  riskScore: number,
): AIProviderResult {
  return {
    providerId: id,
    providerName: id,
    ok: true,
    latencyMs: 12,
    output: {
      decision,
      confidence,
      targetPrice: null,
      stopPrice: null,
      estimatedDurationSec: 120,
      reasoningShort: "test",
      riskScore,
      metadata: { remote: true, remoteCoverage: 1 },
    },
  };
}

describe("consensus-engine", () => {
  beforeEach(() => {
    expect(AI_CONSENSUS_POLICY.minDirectionalVoteHardBlock).toBe(false);
  });

  it("averages provider opportunity score", () => {
    const score = scoreTradeOpportunity([
      provider("p1", "BUY", 80, 30),
      provider("p2", "BUY", 60, 35),
    ]);
    expect(score).toBeGreaterThan(0.5);
  });

  it("rejects when majority providers exceed risk threshold", () => {
    const result = rejectUnsafeTrade([
      provider("p1", "BUY", 70, 80),
      provider("p2", "BUY", 72, 78),
    ]);
    expect(result.reject).toBe(true);
  });

  it("allows soft single-provider BUY without hard vote block", () => {
    const result = summarizeConsensus([provider("p1", "BUY", 72, 40)]);
    expect(result.finalDecision).toBe("BUY");
    expect(result.rejected).toBe(false);
  });

  it("does not force NO_TRADE when one provider BUY passes soft threshold", () => {
    const result = summarizeConsensus([
      provider("p1", "BUY", 68, 42),
      provider("p2", "HOLD", 55, 38),
    ]);
    expect(result.finalDecision).not.toBe("NO_TRADE");
  });
});
