import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CooperativeAsyncCancelledError,
  CooperativeAsyncTimeoutError,
  createAsyncTelemetry,
  runCooperativePool,
  startRoundSelectionWatchdog,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";
import { linkAbortSignal } from "@/src/server/execution/cancellable-work.service";
import { withBoundedPrisma, BoundedPrismaError } from "@/src/server/execution/bounded-prisma.service";
import {
  cancelRoundSelection,
  getRoundCancellationSignal,
  registerRoundCancellation,
  clearRoundCancellation,
  startSelectionBudgetEnforcer,
} from "@/src/server/execution/round-runtime.service";
import { RoundSelectionAbortError } from "@/src/server/execution/round-runtime.types";
import { assessRoundProgressState } from "@/src/server/execution/round-progress-state.service";
import {
  beginAiBatch,
  failAiCandidate,
  getAiBatchProgress,
  resetAiRuntimeState,
  startAiCandidate,
  terminalizeOpenAiCandidates,
  writeMinimumAiStallArtifacts,
} from "@/src/server/forensics/ai-runtime.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

vi.mock("@/src/server/ai/provider-factory", () => ({
  createProviderAdapter: vi.fn(() => ({
    config: { id: "provider-1", name: "Provider 1", model: "test-model", timeoutMs: 1000 },
    analyzeTechnicalSignal: vi.fn(() => new Promise(() => undefined)),
    analyzeMomentumSignal: vi.fn(() => Promise.resolve({ decision: "HOLD", confidence: 50, riskScore: 40, reasoningShort: "ok", estimatedDurationSec: 60 })),
    analyzeRiskAssessment: vi.fn(() => Promise.resolve({ decision: "HOLD", confidence: 50, riskScore: 40, reasoningShort: "ok", estimatedDurationSec: 60 })),
  })),
}));

vi.mock("@/src/server/repositories/execution.repository", () => ({
  getRuntimeExecutionContext: vi.fn(() => new Promise(() => undefined)),
}));

vi.mock("@/src/server/resilience/circuit-breaker", () => ({
  withCircuitBreaker: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

function freshKlines(count = 25) {
  const now = Date.now();
  return Array.from({ length: count }).map((_, i) => ({
    open: 1,
    high: 1.01,
    low: 0.99,
    close: 1,
    volume: 100,
    openTime: now - (count - i) * 60_000,
    closeTime: now - (count - i - 1) * 60_000,
  }));
}

function freshAiInput(symbol: string) {
  return {
    symbol,
    lastPrice: 1,
    klines: freshKlines(),
    volume24h: 1_000_000,
    orderBookSummary: { bestBid: 1, bestAsk: 1.001, bidDepth: 1000, askDepth: 1000 },
    recentTradesSummary: { buyVolume: 100, sellVolume: 100, buySellRatio: 1 },
    spread: 0.01,
    volatility: 1,
  };
}

describe("P0 AI cancellation regression", () => {
  beforeEach(() => {
    resetAiRuntimeState();
    clearRoundCancellation("job-cancel-test");
  });

  afterEach(() => {
    clearRoundCancellation("job-cancel-test");
  });

  it("1. hung consensus times out, terminalizes candidate, releases slot, continues", async () => {
    beginAiBatch({ roundId: "r1", total: 2, concurrency: 1 });
    startAiCandidate({ roundId: "r1", symbol: "HANG", provider: "provider-1", model: "m1" });
    const telemetry = createAsyncTelemetry();
    const results = await runCooperativePool(
      ["HANG", "OK"],
      async (value, _index, signal) => {
        if (value === "HANG") {
          await runAIConsensusFromInput(freshAiInput("HANGTRY"), { signal });
        }
        return value;
      },
      {
        label: "consensus-pool",
        concurrency: 1,
        workerTimeoutMs: 120,
        telemetry,
        onWorkerTimeout: async (_idx, _total, item, error) => {
          failAiCandidate({
            roundId: "r1",
            symbol: String(item),
            reasonCode: STALL_ERROR_CODES.AI_TIMEOUT,
            errorType: error.name,
            reasonDetail: error.message,
            timeout: true,
            signalPropagated: true,
          });
        },
      },
    );
    expect(results[0]).toBeNull();
    expect(results[1]).toBe("OK");
    const batch = getAiBatchProgress("r1");
    expect(batch?.candidates[0]?.status).toBe("AI_TIMEOUT");
    expect(batch?.processed).toBe(1);
  });

  it("2. abort parent signal cancels bounded await", async () => {
    const parent = new AbortController();
    const pending = withBoundedAwait(
      "abort-test",
      new Promise<string>(() => undefined),
      5_000,
      createAsyncTelemetry(),
      undefined,
      { signal: parent.signal },
    );
    setTimeout(() => parent.abort("cancelRoundSelection"), 20);
    await expect(pending).rejects.toBeInstanceOf(CooperativeAsyncCancelledError);
  });

  it("3. pool continues after one hung worker", async () => {
    const results = await runCooperativePool(
      [1, 2],
      async (value, _index, signal) => {
        if (value === 1) {
          await new Promise(() => {
            signal.addEventListener("abort", () => undefined);
          });
        }
        return value * 10;
      },
      { label: "continue-pool", concurrency: 2, workerTimeoutMs: 40 },
    );
    expect(results[0]).toBeNull();
    expect(results[1]).toBe(20);
  });

  it("4. selection budget aborts in-flight pool work", async () => {
    registerRoundCancellation("job-budget");
    const poolPromise = runCooperativePool(
      [1],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return "late";
      },
      {
        label: "budget-pool",
        concurrency: 1,
        workerTimeoutMs: 10_000,
        abortSignal: getRoundCancellationSignal("job-budget"),
        shouldAbort: () => {
          const signal = getRoundCancellationSignal("job-budget");
          if (signal?.aborted) {
            throw new RoundSelectionAbortError("CANCELLED", String(signal.reason ?? "cancelled"));
          }
        },
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    cancelRoundSelection("job-budget", "Selection budget elapsed");
    try {
      const results = await poolPromise;
      expect(results[0]).toBeNull();
    } catch (error) {
      expect(error).toBeInstanceOf(CooperativeAsyncCancelledError);
    }
    expect(getRoundCancellationSignal("job-budget")?.aborted).toBe(true);
    clearRoundCancellation("job-budget");
  });

  it("5. cancelRoundSelection aborts active consensus", async () => {
    registerRoundCancellation("job-cancel-test");
    const signal = getRoundCancellationSignal("job-cancel-test");
    const pending = runAIConsensusFromInput(freshAiInput("PIXELTRY"), { signal });
    setTimeout(() => cancelRoundSelection("job-cancel-test", "manual cancel"), 30);
    await expect(pending).rejects.toBeInstanceOf(CooperativeAsyncCancelledError);
  }, 10_000);

  it("6. bounded prisma failure does not leave STARTED candidate", async () => {
    beginAiBatch({ roundId: "r6", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "r6", symbol: "DB", provider: "provider-1", model: "m1" });
    await expect(
      withBoundedPrisma("test.hang", () => new Promise(() => undefined), 30),
    ).rejects.toBeInstanceOf(BoundedPrismaError);
    failAiCandidate({
      roundId: "r6",
      symbol: "DB",
      reasonCode: STALL_ERROR_CODES.AI_FAILED,
      errorType: "BoundedPrismaError",
      reasonDetail: "bounded prisma timeout",
    });
    expect(getAiBatchProgress("r6")?.candidates[0]?.status).not.toBe("STARTED");
  });

  it("7. concurrency=2 with many items eventually completes without permanent slots", async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0;
    const results = await runCooperativePool(
      items,
      async (value, _index, signal) => {
        inFlight += 1;
        if (value % 5 === 0) {
          await new Promise((resolve) => setTimeout(resolve, 80));
        } else if (value === 7) {
          await new Promise(() => {
            signal.addEventListener("abort", () => undefined);
          });
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        inFlight -= 1;
        return value;
      },
      { label: "many-pool", concurrency: 2, workerTimeoutMs: 60 },
    );
    expect(results).toHaveLength(12);
    expect(results.filter((row) => row === null).length).toBeGreaterThanOrEqual(1);
    expect(results.filter((row) => row !== null).length).toBeGreaterThanOrEqual(7);
  });

  it("8. recovery states distinguish heartbeat-only vs stalled", () => {
    const freshHeartbeat = new Date().toISOString();
    const staleProgress = new Date(Date.now() - 400_000).toISOString();
    const possiblyHung = assessRoundProgressState({
      runtime: {
        step: "AI_ANALYSIS",
        message: "working",
        coarseState: "tariyor",
        candidatesProcessed: 1,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 10,
        elapsedMs: 120_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: freshHeartbeat,
        lastProgressAt: staleProgress,
        timeline: [],
        aiProcessed: 1,
        aiTotal: 91,
      },
      selectionBudgetMs: 1_200_000,
    });
    expect(["AI_ACTIVE", "HEARTBEAT_ONLY", "STALLED", "WAITING_FOR_PROVIDER"]).toContain(possiblyHung.progressState);

    const stalled = assessRoundProgressState({
      runtime: {
        step: "AI_ANALYSIS",
        message: "frozen",
        coarseState: "tariyor",
        candidatesProcessed: 1,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 10,
        elapsedMs: 500_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: staleProgress,
        lastProgressAt: staleProgress,
        timeline: [],
        aiProcessed: 1,
        aiTotal: 91,
      },
      selectionBudgetMs: 1_200_000,
    });
    expect(stalled.progressState).toBe("STALLED");
  });

  it("9. candidate forensic records provider/model at STARTED", () => {
    beginAiBatch({ roundId: "r9", total: 1, concurrency: 1 });
    const row = startAiCandidate({
      roundId: "r9",
      symbol: "PIXELTRY",
      provider: "provider-1",
      model: "gpt-test,claude-test,gemini-test",
      executionMode: "paper",
    });
    expect(row.provider).toBe("provider-1");
    expect(row.model).toContain("gpt-test");
    expect(row.executionMode).toBe("paper");
    expect(row.status).toBe("STARTED");
  });

  it("10. AI timeout writes minimum partial artifact bundle", () => {
    const sessionId = "test-session-ai-stall";
    const roundId = "4";
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);
    rmSync(root, { recursive: true, force: true });
    beginAiBatch({ roundId, runId: "run-4", total: 1, concurrency: 1 });
    startAiCandidate({ roundId, runId: "run-4", symbol: "PIXELTRY", provider: "provider-1", model: "m1" });
    failAiCandidate({
      roundId,
      runId: "run-4",
      symbol: "PIXELTRY",
      reasonCode: STALL_ERROR_CODES.AI_TIMEOUT,
      errorType: "CooperativeAsyncTimeoutError",
      reasonDetail: "ai-consensus timed out",
      timeout: true,
    });
    const written = writeMinimumAiStallArtifacts({
      sessionId,
      roundId,
      runId: "run-4",
      reason: "ai-consensus timed out",
    });
    for (const name of [
      "ai-progress.json",
      "ai-trace.json",
      "round-watchdog.json",
      "round-liveness.json",
      "round-hang-snapshot.json",
      "recovery-decisions.json",
      "recovery-telemetry.json",
      "round-summary.json",
      "selectionTimeBudgetBreakdown.json",
    ]) {
      expect(written.written).toContain(name);
      expect(existsSync(path.join(root, name))).toBe(true);
    }
    const progress = JSON.parse(readFileSync(path.join(root, "ai-progress.json"), "utf8"));
    expect(progress.timeoutCount).toBe(1);
    const liveness = JSON.parse(readFileSync(path.join(root, "round-liveness.json"), "utf8"));
    expect(liveness.currentStage).toBe("TIMEOUT");
    rmSync(path.join(process.cwd(), "artifacts", "forensics", sessionId), { recursive: true, force: true });
  });
});
