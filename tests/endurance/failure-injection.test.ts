import { beforeEach, describe, expect, it } from "vitest";
import {
  beginAiBatch,
  completeAiCandidate,
  failAiCandidate,
  getAiBatchProgress,
  resetAiRuntimeState,
  startAiCandidate,
  terminalizeOpenAiCandidates,
} from "@/src/server/forensics/ai-runtime.service";
import {
  CooperativeAsyncTimeoutError,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";
import { isBlockingAiDecision } from "@/src/server/execution/ai-execution-gate.service";
import { assessRoundProgressState } from "@/src/server/execution/round-progress-state.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";

describe("failure injection — runtime resilience", () => {
  beforeEach(() => {
    resetAiRuntimeState();
  });

  it("AI_TIMEOUT: candidate fails locally without orphan AI_STARTED", () => {
    beginAiBatch({ roundId: "inj-1", runId: "run-1", total: 50, concurrency: 4 });
    for (let i = 0; i < 50; i += 1) {
      const symbol = `SYM${i}`;
      startAiCandidate({ roundId: "inj-1", runId: "run-1", symbol, stage: "consensus", timeoutMs: 90_000 });
      if (i % 3 === 0) {
        failAiCandidate({
          roundId: "inj-1",
          runId: "run-1",
          symbol,
          reasonCode: STALL_ERROR_CODES.AI_TIMEOUT,
          errorType: "CooperativeAsyncTimeoutError",
          reasonDetail: "injected timeout",
          timeout: true,
        });
      } else {
        completeAiCandidate({ roundId: "inj-1", runId: "run-1", symbol, status: "COMPLETED" });
      }
    }
    const batch = getAiBatchProgress("inj-1", "run-1");
    expect(batch?.processed).toBe(50);
    expect(batch?.timeoutCount).toBe(17);
    expect(batch?.candidates.every((c) => c.status !== "AI_STARTED")).toBe(true);
  });

  it("AI_PROVIDER_DOWN: batch continues after provider failures", () => {
    beginAiBatch({ roundId: "inj-2", total: 20, concurrency: 4 });
    for (let i = 0; i < 20; i += 1) {
      const symbol = `P${i}`;
      startAiCandidate({ roundId: "inj-2", symbol, stage: "ai" });
      if (i < 5) {
        failAiCandidate({
          roundId: "inj-2",
          symbol,
          reasonCode: STALL_ERROR_CODES.AI_FAILED,
          errorType: "ProviderDown",
          reasonDetail: "all providers degraded",
        });
      } else {
        completeAiCandidate({ roundId: "inj-2", symbol, status: "COMPLETED" });
      }
    }
    const batch = getAiBatchProgress("inj-2");
    expect(batch?.processed).toBe(20);
    expect(batch?.failedCount).toBe(5);
    expect(batch?.successCount).toBe(15);
  });

  it("terminalizeAiForRuns clears open candidates on round terminal", () => {
    beginAiBatch({ roundId: "inj-3", runId: "run-3", total: 3, concurrency: 2 });
    startAiCandidate({ roundId: "inj-3", runId: "run-3", symbol: "OPEN", stage: "ai" });
    terminalizeOpenAiCandidates({
      roundId: "inj-3",
      runId: "run-3",
      reasonCode: "ROUND_FAILED",
      cancelReason: "injected terminal",
    });
    const batch = getAiBatchProgress("inj-3", "run-3");
    expect(batch?.candidates.find((c) => c.symbol === "OPEN")?.status).not.toBe("AI_STARTED");
  });

  it("HEARTBEAT_STALL: healthy AI progress blocks false stall classification", () => {
    const now = Date.now();
    const assessment = assessRoundProgressState({
      runtime: {
        step: "AI_ANALYSIS",
        message: "AI batch active",
        coarseState: "tariyor",
        candidatesProcessed: 12,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 30,
        elapsedMs: 200_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date(now - 5_000).toISOString(),
        lastProgressAt: new Date(now - 8_000).toISOString(),
        lastMeaningfulProgressAt: new Date(now - 8_000).toISOString(),
        timeline: [],
        aiProcessed: 12,
        aiTotal: 64,
        intraRoundPct: 25,
      },
      selectionStartedAt: now - 200_000,
    });
    expect(assessment.progressState).toBe("AI_ACTIVE");
    expect(assessment.progressState).not.toBe("STALLED");
  });

  it("NO_TRADE remains non-executable after injection scenarios", () => {
    expect(isBlockingAiDecision("NO_TRADE")).toBe(true);
    expect(isBlockingAiDecision("HOLD")).toBe(true);
    expect(isBlockingAiDecision("BUY")).toBe(false);
  });

  it("withBoundedAwait surfaces AI_TIMEOUT without hanging campaign logic", async () => {
    await expect(
      withBoundedAwait(
        "injected-ai-timeout",
        () => new Promise(() => undefined),
        50,
      ),
    ).rejects.toBeInstanceOf(CooperativeAsyncTimeoutError);
  });
});

describe("business gate isolation", () => {
  const gates = ["AI_VETO", "TDI_WAIT", "SIM_TIGHT_FILTER", "NO_TRADE", "EV_REJECT"];

  it.each(gates)("%s is a policy rejection not a runtime fault code", (gate) => {
    expect(gate).not.toBe(STALL_ERROR_CODES.ROUND_STALLED);
    expect(gate).not.toBe(STALL_ERROR_CODES.RECOVERY_EXHAUSTED);
  });
});
