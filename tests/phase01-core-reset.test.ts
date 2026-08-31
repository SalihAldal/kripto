import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import type { MarketContext } from "@/src/types/scanner";
import {
  evaluateAiExecutionReadiness,
  resolveAiExecutionGatePolicy,
} from "@/src/server/execution/ai-execution-gate.service";
import type { AIConsensusResult } from "@/src/types/ai";
import {
  claimCriticalWorker,
  getClaimedCriticalWorkerCount,
  resetCriticalWorkerOwnershipForTests,
  CANONICAL_CRITICAL_WORKER_IDS,
} from "@/src/server/hot-path/worker-ownership.service";
import { LEGACY_WORKER_REGISTRY } from "@/src/server/hot-path/hot-path.registry";
import {
  claimCanonicalExecutionAttempt,
  resetCanonicalExecutionAttemptsForTests,
} from "@/src/server/hot-path/execution-attempt-lock.service";
import {
  evaluateCanonicalRiskDecision,
  mapRiskReasonsToCodes,
} from "@/src/server/risk/canonical-risk-decision.service";
import {
  canSpendMarketDataWeight,
  marketDataOrchestrator,
} from "@/src/server/market-data/market-data-orchestrator.service";
import { MarketDataUnavailableError } from "@/src/server/market-data/market-data-unavailable.error";
import { upsertCandidatePipelineTrace, getCandidatePipelineTrace, resetCandidatePipelineTracesForTests } from "@/src/server/hot-path/candidate-pipeline-trace.service";
import { PRODUCTION_FORBIDDEN_HOT_PATH_MODULES } from "@/src/server/hot-path/canonical-pipeline";

vi.mock("@/src/server/risk/risk-evaluation.service", () => ({
  evaluatePreTradeRisk: vi.fn(async (input: { confidencePercent?: number }) => {
    if ((input.confidencePercent ?? 100) < 0) {
      return { ok: false, reasons: ["Max daily loss breaker"], paused: false, effectiveConfig: {} };
    }
    return { ok: true, reasons: [], paused: false, effectiveConfig: {} };
  }),
}));

function context(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    symbol: "BTCUSDT",
    lastPrice: 100,
    change24h: 1.2,
    volume24h: 20_000_000,
    volumeSpikePercent: 10,
    spreadPercent: 0.08,
    volatilityPercent: 1.3,
    momentumPercent: 0.8,
    orderBookImbalance: 0.2,
    buyPressure: 0.62,
    shortCandleSignal: 2,
    fakeSpikeScore: 0.3,
    pumpRisk: 20,
    pumpIntensity: 40,
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: 0.2,
      shortFlowImbalance: 0.25,
      tradeVelocity: 1.2,
    },
    ...overrides,
  };
}

function mockAi(input: {
  finalDecision: string;
  consensus?: string | null;
  withProviders?: boolean;
  omitConsensus?: boolean;
}): AIConsensusResult {
  const consensusValue = input.omitConsensus
    ? undefined
    : input.consensus === null
      ? undefined
      : (input.consensus ?? input.finalDecision);
  return {
    finalDecision: input.finalDecision,
    finalConsensusDecision: consensusValue as AIConsensusResult["finalConsensusDecision"],
    confidence: 80,
    finalConfidence: 80,
    explanation: "test",
    generatedAt: new Date().toISOString(),
    outputs: input.withProviders === false
      ? []
      : [{ providerId: "p1", ok: true, weight: 1, output: { decision: input.finalDecision, confidence: 80 } }],
    decisionPayload: input.omitConsensus
      ? {}
      : {
          consensusEngine: { finalDecision: input.consensus ?? input.finalDecision },
        },
  } as unknown as AIConsensusResult;
}

describe("Phase 1 core reset — scoring", () => {
  it("fakeSpikePenalty reduces score", () => {
    const clean = scoreContext(context({ fakeSpikeScore: 0 }));
    const spiked = scoreContext(context({ fakeSpikeScore: 4 }));
    expect(spiked.metrics.fakeSpikePenalty).toBeGreaterThan(clean.metrics.fakeSpikePenalty);
    expect(spiked.score).toBeLessThan(clean.score);
  });

  it("positive buy pressure increases LONG score", () => {
    const weakBuy = scoreContext(context({ buyPressure: 0.52 }));
    const strongBuy = scoreContext(context({ buyPressure: 0.85 }));
    expect(strongBuy.score).toBeGreaterThan(weakBuy.score);
    expect(strongBuy.metrics.pressure).toBeGreaterThan(weakBuy.metrics.pressure);
  });

  it("strong sell pressure does not increase LONG score the same way", () => {
    const strongBuy = scoreContext(context({ buyPressure: 0.8 }));
    const strongSell = scoreContext(context({ buyPressure: 0.2 }));
    expect(strongSell.score).toBeLessThan(strongBuy.score);
    expect(strongSell.metrics.pressure).toBeLessThan(0);
    expect(strongBuy.metrics.pressure).toBeGreaterThan(0);
  });

  it("negative order-book imbalance has directional impact", () => {
    const bidHeavy = scoreContext(context({ orderBookImbalance: 0.4 }));
    const askHeavy = scoreContext(context({ orderBookImbalance: -0.4 }));
    expect(askHeavy.score).toBeLessThan(bidHeavy.score);
    expect(askHeavy.metrics.orderBook).toBeLessThan(0);
    expect(bidHeavy.metrics.orderBook).toBeGreaterThan(0);
  });
});

describe("Phase 1 core reset — AI advisory", () => {
  it("production policy is ADVISORY", () => {
    expect(resolveAiExecutionGatePolicy({ mode: "paper", learningLane: true })).toBe("ADVISORY");
    expect(resolveAiExecutionGatePolicy({ mode: "live", learningLane: false })).toBe("ADVISORY");
  });

  it("AI NO_OPINION does not hard-veto a deterministic candidate", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "NO_OPINION", consensus: "NO_OPINION" }),
      policy: "ADVISORY",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).not.toBe("AI_GATE_BLOCK");
    expect(gate.verdict).toBe("AI_ADVISORY_ONLY");
    expect(gate.executionSide).toBe("BUY");
    expect(gate.reasonCode).toBe("AI_NO_OPINION");
  });

  it("AI timeout/missing does not hard-veto a deterministic candidate", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: null,
      policy: "ADVISORY",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).not.toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_TIMEOUT");
    expect(gate.executionSide).toBe("BUY");
  });
});

describe("Phase 1 core reset — risk / TDI / synthetic", () => {
  it("hard risk reject blocks with machine-readable reason codes", async () => {
    const decision = await evaluateCanonicalRiskDecision({
      userId: "u1",
      symbol: "BTCUSDT",
      confidencePercent: -1,
      spreadPercent: 0.05,
      liquidity24h: 5_000_000,
      expectedProfitPercent: 1,
      slippagePercent: 0.05,
      volatilityPercent: 1,
      riskPerTradePercent: 0.4,
    });
    expect(decision.verdict).toBe("REJECT");
    expect(decision.reasonCodes).toContain("RISK_DAILY_LOSS_LIMIT");
    expect(decision.reasonCodes.every((code) => code !== "NO_TRADE")).toBe(true);
  });

  it("TDI reject stays advisory/shadow and does not appear as AI hard veto", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "NO_TRADE", consensus: "NO_TRADE" }),
      policy: "ADVISORY",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_ADVISORY_ONLY");
    expect(gate.verdict).not.toBe("AI_GATE_BLOCK");
  });

  it("live synthetic market data cannot produce a trading ALLOW", async () => {
    const decision = await evaluateCanonicalRiskDecision({
      userId: "u1",
      symbol: "BTCUSDT",
      confidencePercent: 80,
      spreadPercent: 0.05,
      liquidity24h: 5_000_000,
      expectedProfitPercent: 1,
      slippagePercent: 0.05,
      volatilityPercent: 1,
      riskPerTradePercent: 0.4,
      lastPrice: 100,
      syntheticData: true,
    });
    expect(decision.verdict).toBe("REJECT");
    expect(decision.reasonCodes).toContain("RISK_SYNTHETIC_DATA");
  });

  it("every reject maps to a machine-readable reason code", () => {
    const codes = mapRiskReasonsToCodes([
      "Spread above threshold",
      "Liquidity below threshold",
      "Max daily loss breaker",
      "mystery reason",
    ]);
    expect(codes).toEqual([
      "RISK_SPREAD_TOO_HIGH",
      "RISK_LOW_LIQUIDITY",
      "RISK_DAILY_LOSS_LIMIT",
      "RISK_UNSPECIFIED",
    ]);
  });
});

describe("Phase 1 core reset — workers and execution uniqueness", () => {
  beforeEach(() => {
    resetCriticalWorkerOwnershipForTests();
    resetCanonicalExecutionAttemptsForTests();
    resetCandidatePipelineTracesForTests();
  });

  it("duplicate critical worker cannot be claimed", () => {
    expect(claimCriticalWorker("scanner").ok).toBe(true);
    const second = claimCriticalWorker("scanner");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("DUPLICATE_CRITICAL_WORKER");
    expect(getClaimedCriticalWorkerCount()).toBe(1);
  });

  it("canonical critical owners are unique", () => {
    const critical = LEGACY_WORKER_REGISTRY.filter((row) => row.tier === "CRITICAL");
    expect(critical.map((row) => row.id).sort()).toEqual([...CANONICAL_CRITICAL_WORKER_IDS].sort());
    expect(new Set(critical.map((row) => row.ownership)).size).toBe(critical.length);
  });

  it("same candidate cannot enter two execution paths", () => {
    const first = claimCanonicalExecutionAttempt({ candidateId: "BTCUSDT:1", executionId: "exec-1" });
    const second = claimCanonicalExecutionAttempt({ candidateId: "BTCUSDT:1", executionId: "exec-2" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("DUPLICATE_EXECUTION_PATH");
  });

  it("a candidate has at most one canonical execution attempt", () => {
    claimCanonicalExecutionAttempt({ candidateId: "ETHUSDT:9", executionId: "a" });
    claimCanonicalExecutionAttempt({ candidateId: "ETHUSDT:9", executionId: "b" });
    expect(getClaimedCriticalWorkerCount()).toBe(0);
    const retry = claimCanonicalExecutionAttempt({ candidateId: "ETHUSDT:9", executionId: "c" });
    expect(retry.ok).toBe(false);
  });
});

describe("Phase 1 core reset — rate limit and observability", () => {
  it("high priority requests do not bypass the weight budget", async () => {
    marketDataOrchestrator.resetTelemetry();
    marketDataOrchestrator.seedWeightUsageForTests(5_500);
    expect(canSpendMarketDataWeight("ticker", "high")).toBe(false);
    expect(canSpendMarketDataWeight("ticker", "critical")).toBe(false);
    await expect(marketDataOrchestrator.getTicker("BTCUSDT", { priority: "high" })).rejects.toBeInstanceOf(
      MarketDataUnavailableError,
    );
  });

  it("candidate pipeline trace records signal, AI, TDI, risk, execution", () => {
    const trace = upsertCandidatePipelineTrace({
      candidateId: "cand-1",
      symbol: "XYZUSDT",
      signal: { score: 71, lane: "SCANNER", reasons: ["momentum"] },
      ai: { decision: "NO_OPINION", confidence: null, status: "NO_OPINION" },
      tdi: { decision: "REJECTED", confidence: 40, role: "SHADOW" },
      risk: { verdict: "REJECT", reasonCodes: ["RISK_SPREAD_TOO_HIGH"] },
      execution: { attempted: false, orderId: null, result: "NOT_ATTEMPTED" },
    });
    const loaded = getCandidatePipelineTrace("cand-1");
    expect(loaded?.symbol).toBe("XYZUSDT");
    expect(loaded?.risk.reasonCodes).toContain("RISK_SPREAD_TOO_HIGH");
    expect(loaded?.tdi.role).toBe("SHADOW");
    expect(trace.ai.status).toBe("NO_OPINION");
  });
});

describe("Phase 1 core reset — canonical hot-path does not import legacy modules", () => {
  it("execution orchestrator does not import forbidden legacy/shadow engines", () => {
    const file = path.join(process.cwd(), "src/server/execution/execution-orchestrator.service.ts");
    const src = readFileSync(file, "utf8");
    for (const forbidden of PRODUCTION_FORBIDDEN_HOT_PATH_MODULES) {
      expect(src.includes(forbidden)).toBe(false);
    }
    expect(src).toContain("evaluateCanonicalRiskDecision");
    expect(src).toContain("executeApprovedSpotOrder");
  });
});
