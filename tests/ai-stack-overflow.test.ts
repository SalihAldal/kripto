import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as indicatorSuite from "@/src/server/ai/indicator-suite";
import {
  CooperativeAsyncCancelledError,
  createAsyncTelemetry,
  runCooperativePool,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";
import {
  cancelRoundSelection,
  clearRoundCancellation,
  getRoundCancellationSignal,
  registerRoundCancellation,
  startSelectionBudgetEnforcer,
} from "@/src/server/execution/round-runtime.service";
import { linkAbortSignal } from "@/src/server/execution/cancellable-work.service";
import { runAIConsensusFromInput, runLegacyAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { createProviderAdapter } from "@/src/server/ai/provider-factory";
import { resolveIndicatorSnapshot } from "@/src/server/ai/indicator-suite";
import { failAiCandidate, resetAiRuntimeState, beginAiBatch, startAiCandidate, getAiBatchProgress } from "@/src/server/forensics/ai-runtime.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import type { AIAnalysisInput } from "@/src/types/ai";

function mockLaneOutput(lane: string) {
  return {
    decision: lane === "risk" ? ("HOLD" as const) : ("BUY" as const),
    confidence: 74,
    riskScore: 34,
    targetPrice: 1.06,
    stopPrice: 0.94,
    estimatedDurationSec: 180,
    reasoningShort: `${lane} mock ok`,
    metadata: { remote: true, remoteCoverage: 1, providerLane: lane },
  };
}

vi.mock("@/src/server/ai/provider-factory", () => ({
  createProviderAdapter: vi.fn(),
}));

function mockFastProviders() {
  vi.mocked(createProviderAdapter).mockImplementation(() => ({
    config: { id: "provider-1", name: "Provider 1", model: "test-model", timeoutMs: 5000 },
    analyzeTechnicalSignal: vi.fn(() => Promise.resolve(mockLaneOutput("technical"))),
    analyzeMomentumSignal: vi.fn(() => Promise.resolve(mockLaneOutput("momentum"))),
    analyzeRiskAssessment: vi.fn(() => Promise.resolve(mockLaneOutput("risk"))),
  }));
}

function mockHangingProviders() {
  vi.mocked(createProviderAdapter).mockImplementation(() => ({
    config: { id: "provider-1", name: "Provider 1", model: "test-model", timeoutMs: 5000 },
    analyzeTechnicalSignal: vi.fn(() => new Promise(() => undefined)),
    analyzeMomentumSignal: vi.fn(() => new Promise(() => undefined)),
    analyzeRiskAssessment: vi.fn(() => new Promise(() => undefined)),
  }));
}

vi.mock("@/src/server/repositories/execution.repository", () => ({
  getRuntimeExecutionContext: vi.fn(() => Promise.resolve({ user: { id: "stack-overflow-test-user" } })),
}));

vi.mock("@/src/server/resilience/circuit-breaker", () => ({
  withCircuitBreaker: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@/src/server/decision-engine/master-decision-engine.service", () => ({
  adjudicateWithMasterDecisionEngine: vi.fn(({ legacyResult }: { legacyResult: unknown }) =>
    Promise.resolve(legacyResult),
  ),
}));

vi.mock("@/src/server/learning-engine/learning-engine.repository", () => ({
  listConfidenceCalibration: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/src/server/ai/ai-performance.service", () => ({
  applyAiPerformanceWeights: vi.fn((_userId: string, rows: unknown[]) => Promise.resolve(rows)),
  ensureAiPerformanceEvaluator: vi.fn(),
  recordAiPerformancePrediction: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/src/server/ai/ai-analysis-memory.service", () => ({
  adjustConfidenceWithAnalysisMemory: vi.fn((value: number) => value),
  recordAIAnalysisPrediction: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/src/server/observability/trade-event-log", () => ({
  logTradeEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/src/server/forensics/forensic-bridge.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/forensics/forensic-bridge.service")>();
  return {
    ...actual,
    bridgeAiProviderResult: vi.fn(),
    bridgeConsensusResult: vi.fn(),
    bridgeHybridEv: vi.fn(),
  };
});

vi.mock("@/src/server/forensics/ai-runtime.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/forensics/ai-runtime.service")>();
  return {
    ...actual,
    recordConsensusAudit: vi.fn(),
  };
});

const decisionTimelineCreateMany = vi.fn(() => Promise.resolve({ count: 0 }));
const upsertDecisionLogRecord = vi.fn(() => Promise.resolve(null));

vi.mock("@/src/server/repositories/decision-log.repository", () => ({
  appendDecisionTimelineEvents: vi.fn(() => Promise.resolve()),
  upsertDecisionLogRecord: (...args: unknown[]) => upsertDecisionLogRecord(...args),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    decisionTimelineEvent: {
      createMany: (...args: unknown[]) => decisionTimelineCreateMany(...args),
    },
  },
}));

function freshKlines(count = 80) {
  const now = Date.now();
  return Array.from({ length: count }).map((_, i) => ({
    open: 1 + i * 0.001,
    high: 1.01 + i * 0.001,
    low: 0.99 + i * 0.001,
    close: 1 + i * 0.001,
    volume: 120 + i,
    openTime: now - (count - i) * 60_000,
    closeTime: now - (count - i - 1) * 60_000,
  }));
}

function freshAiInput(symbol: string, overrides?: Partial<AIAnalysisInput>): AIAnalysisInput {
  return {
    symbol,
    lastPrice: 1.05,
    klines: freshKlines(),
    volume24h: 2_500_000,
    orderBookSummary: { bestBid: 1.04, bestAsk: 1.06, bidDepth: 120_000, askDepth: 110_000 },
    recentTradesSummary: { buyVolume: 50_000, sellVolume: 45_000, buySellRatio: 1.1 },
    spread: 0.02,
    volatility: 1.2,
    marketSignals: {
      change24h: 1.8,
      shortMomentumPercent: 0.35,
      shortFlowImbalance: 0.12,
      tradeVelocity: 1.4,
    },
    multiTimeframe: {
      entry: {
        m1: { direction: "BULLISH", strength: 62, slopePercent: 0.3, lastClose: 1.05 },
        m5: { direction: "BULLISH", strength: 64, slopePercent: 0.4, lastClose: 1.04 },
      },
      trend: {
        m15: { direction: "BULLISH", strength: 70, slopePercent: 1.1, lastClose: 1.03 },
        h1: { direction: "BULLISH", strength: 72, slopePercent: 2.0, lastClose: 1.02 },
      },
      macro: {
        h4: { direction: "BULLISH", strength: 75, slopePercent: 3.2, lastClose: 1.0 },
        d1: { direction: "BULLISH", strength: 78, slopePercent: 4.5, lastClose: 0.98 },
      },
      dominantTrend: "BULLISH",
      conflict: false,
      trendAligned: true,
      entrySuitable: true,
      reason: "MTF aligned",
    },
    ...overrides,
  };
}

describe("P0 AI stack overflow regression", () => {
  let buildSnapshotSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetAiRuntimeState();
    clearRoundCancellation("stack-overflow-budget");
    mockFastProviders();
    buildSnapshotSpy = vi.spyOn(indicatorSuite, "buildIndicatorSnapshot");
    decisionTimelineCreateMany.mockClear();
    upsertDecisionLogRecord.mockReset();
    upsertDecisionLogRecord.mockImplementation(() => Promise.resolve(null));
  });

  afterEach(() => {
    buildSnapshotSpy?.mockRestore();
    clearRoundCancellation("stack-overflow-budget");
    clearRoundCancellation("stack-overflow-cancel");
    vi.restoreAllMocks();
    mockFastProviders();
  });

  it("1. full mock consensus with concurrency=2 completes without RangeError", async () => {
    const symbols = ["FILTRY", "BTCTRY", "ETHTRY", "ADATRY"];
    const results = await runCooperativePool(
      symbols,
      async (symbol, _index, signal) => {
        return runLegacyAIConsensusFromInput(freshAiInput(symbol), { signal });
      },
      { label: "consensus-stress", concurrency: 2, workerTimeoutMs: 15_000 },
    );
    for (const row of results) {
      expect(row).not.toBeNull();
      expect(row?.generatedAt).toBeTruthy();
    }
    expect(results.every((row) => row !== null)).toBe(true);
  });

  it("2. buildIndicatorSnapshot is called at most once per consensus invocation", async () => {
    buildSnapshotSpy.mockClear();
    const result = await runLegacyAIConsensusFromInput(freshAiInput("FILTRY"));
    expect(buildSnapshotSpy).toHaveBeenCalledTimes(1);
    expect(result.consensusTelemetry?.indicatorSnapshotBuildCount).toBeLessThanOrEqual(1);
    expect(result.consensusTelemetry?.indicatorSnapshotBuildCount).toBe(1);
  });

  it("3. FILTRY pattern: provider lanes succeed then hybrid decision without stack overflow", async () => {
    const result = await runLegacyAIConsensusFromInput(freshAiInput("FILTRY"));
    expect(result.outputs.length).toBeGreaterThan(0);
    expect(result.outputs.every((row) => row.ok)).toBe(true);
    expect(result.outputs.some((row) => Boolean(row.output?.metadata?.remote))).toBe(true);
    expect(result.finalDecision).toBeTruthy();
    expect(buildSnapshotSpy).toHaveBeenCalledTimes(1);
  });

  it("4. concurrency=2 with two candidates concurrently avoids RangeError", async () => {
    const [a, b] = await Promise.all([
      runLegacyAIConsensusFromInput(freshAiInput("FILTRY")),
      runLegacyAIConsensusFromInput(freshAiInput("PIXELTRY")),
    ]);
    expect(a.generatedAt).toBeTruthy();
    expect(b.generatedAt).toBeTruthy();
    expect(buildSnapshotSpy.mock.calls.length).toBe(2);
  });

  it("5. synthetic RangeError propagates without recursive re-evaluation", async () => {
    const hybridModule = await import("@/src/server/ai/hybrid-decision-engine");
    const hybridSpy = vi.spyOn(hybridModule, "buildHybridDecision").mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    await expect(runLegacyAIConsensusFromInput(freshAiInput("FILTRY"))).rejects.toThrow(
      /AI_STACK_DEPTH_GUARD:hybrid_decision/i,
    );
    expect(hybridSpy).toHaveBeenCalledTimes(1);
    hybridSpy.mockRestore();
  });

  it("6. cancellation still works after snapshot memoization refactor", async () => {
    mockHangingProviders();
    registerRoundCancellation("stack-overflow-cancel");
    const signal = getRoundCancellationSignal("stack-overflow-cancel");
    const pending = runLegacyAIConsensusFromInput(freshAiInput("PIXELTRY"), { signal });
    setTimeout(() => cancelRoundSelection("stack-overflow-cancel", "manual cancel"), 30);
    await expect(pending).rejects.toBeInstanceOf(CooperativeAsyncCancelledError);
  }, 10_000);

  it("7. selection budget still aborts in-flight bounded work", async () => {
    registerRoundCancellation("stack-overflow-budget");
    const stopBudget = startSelectionBudgetEnforcer(
      "stack-overflow-budget",
      Date.now(),
      40,
    );
    const poolPromise = runCooperativePool(
      [1],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return "late";
      },
      {
        label: "budget-pool-stack",
        concurrency: 1,
        workerTimeoutMs: 10_000,
        abortSignal: getRoundCancellationSignal("stack-overflow-budget"),
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    cancelRoundSelection("stack-overflow-budget", "Selection budget elapsed");
    stopBudget();
    try {
      const results = await poolPromise;
      expect(results[0]).toBeNull();
    } catch (error) {
      expect(error).toBeInstanceOf(CooperativeAsyncCancelledError);
    }
  });

  it("8. provider metadata remains correct after refactor", async () => {
    const result = await runLegacyAIConsensusFromInput(freshAiInput("FILTRY"));
    const remoteRows = result.outputs.filter((row) => Boolean(row.output?.metadata?.remote));
    expect(remoteRows.length).toBeGreaterThanOrEqual(1);
    expect(result.outputs.every((row) => row.providerId)).toBe(true);
  });

  it("9. memoized snapshot is frozen; resolveIndicatorSnapshot does not rebuild", () => {
    const input = freshAiInput("FILTRY");
    const memo = Object.freeze(indicatorSuite.buildIndicatorSnapshot(input));
    input.indicatorSnapshot = memo;
    buildSnapshotSpy.mockClear();
    expect(resolveIndicatorSnapshot(input)).toBe(memo);
    expect(buildSnapshotSpy).not.toHaveBeenCalled();
    expect(() => {
      (memo as { rsi14: number }).rsi14 = 999;
    }).toThrow();
  });

  it("10. consensus telemetry records single snapshot build and phase timings", async () => {
    const result = await runLegacyAIConsensusFromInput(freshAiInput("FILTRY"));
    expect(result.consensusTelemetry?.indicatorSnapshotBuildCount).toBe(1);
    expect(result.consensusTelemetry?.indicatorSnapshotBuildMs).toBeGreaterThanOrEqual(0);
    expect(result.consensusTelemetry?.hybridDecisionMs).toBeGreaterThanOrEqual(0);
    expect(result.consensusTelemetry?.consensusAssemblyMs).toBeGreaterThanOrEqual(0);
    expect((result.consensusTelemetry?.phaseTraces ?? []).length).toBeGreaterThan(0);
    expect((result.consensusTelemetry?.phaseTraces ?? []).some((row) => row.phase === "hybrid_decision")).toBe(true);
  });

  it("11. worker catches synthetic RangeError and terminalizes candidate without retry loop", async () => {
    beginAiBatch({ roundId: "r-stack", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "r-stack", symbol: "FILTRY", provider: "provider-1", model: "m1" });
    const hybridModule = await import("@/src/server/ai/hybrid-decision-engine");
    vi.spyOn(hybridModule, "buildHybridDecision").mockImplementation(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    const results = await runCooperativePool(
      ["FILTRY"],
      async (symbol, _index, signal) => {
        try {
          await runLegacyAIConsensusFromInput(freshAiInput(String(symbol)), { signal });
          return "ok";
        } catch (error) {
          failAiCandidate({
            roundId: "r-stack",
            symbol: String(symbol),
            reasonCode: STALL_ERROR_CODES.AI_FAILED,
            errorType: (error as Error).name,
            reasonDetail: (error as Error).message,
          });
          return null;
        }
      },
      { label: "range-error-pool", concurrency: 1, workerTimeoutMs: 5_000 },
    );
    expect(results[0]).toBeNull();
    expect(getAiBatchProgress("r-stack")?.candidates[0]?.status).toBe("AI_FAILED");
  });

  it("11b. one guarded candidate does not block next candidate at concurrency=2", async () => {
    const hybridModule = await import("@/src/server/ai/hybrid-decision-engine");
    const original = hybridModule.buildHybridDecision;
    const hybridSpy = vi.spyOn(hybridModule, "buildHybridDecision").mockImplementation((payload: Parameters<typeof original>[0]) => {
      if (payload.analysisInput.symbol === "FAILTRY") {
        throw new RangeError("Maximum call stack size exceeded");
      }
      return original(payload);
    });
    const results = await runCooperativePool(
      ["FAILTRY", "OKTRY"],
      async (symbol, _index, signal) => {
        try {
          return await runLegacyAIConsensusFromInput(freshAiInput(symbol), { signal });
        } catch {
          return null;
        }
      },
      { label: "stack-guard-isolation", concurrency: 2, workerTimeoutMs: 15_000 },
    );
    expect(results.filter((row) => row !== null).length).toBeGreaterThanOrEqual(1);
    hybridSpy.mockRestore();
  });

  it("12. stack-overflow remediation does not amplify decisionTimelineEvent.createMany calls", async () => {
    const before = decisionTimelineCreateMany.mock.calls.length;
    await runLegacyAIConsensusFromInput(freshAiInput("FILTRY"));
    await runLegacyAIConsensusFromInput(freshAiInput("BTCTRY"));
    const delta = decisionTimelineCreateMany.mock.calls.length - before;
    expect(delta).toBeLessThanOrEqual(4);
  });

  it("13. bounded await abort still propagates through consensus wrapper", async () => {
    mockHangingProviders();
    const parent = linkAbortSignal();
    const pending = withBoundedAwait(
      "stack-overflow-abort",
      (signal) => runLegacyAIConsensusFromInput(freshAiInput("FILTRY"), { signal }),
      8_000,
      createAsyncTelemetry(),
      undefined,
      { signal: parent.signal },
    );
    setTimeout(() => parent.abort("cancel"), 30);
    await expect(pending).rejects.toBeInstanceOf(CooperativeAsyncCancelledError);
  }, 10_000);

  it("14. observeAiDecision RangeError does not fail consensus result", async () => {
    upsertDecisionLogRecord.mockImplementationOnce(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    const result = await runAIConsensusFromInput(freshAiInput("STACKTRY"));
    expect(result.generatedAt).toBeTruthy();
    expect(result.finalDecision).toBeTruthy();
  });
});
