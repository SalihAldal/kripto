import { describe, expect, it, beforeEach } from "vitest";
import {
  beginAiBatch,
  cancelAiCandidate,
  completeAiCandidate,
  failAiCandidate,
  getAiBatchProgress,
  resetAiRuntimeState,
  startAiCandidate,
  terminalizeOpenAiCandidates,
} from "@/src/server/forensics/ai-runtime.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import {
  cancelRoundSelection,
  clearRoundCancellation,
  getRoundCancellationSignal,
  registerRoundCancellation,
} from "@/src/server/execution/round-runtime.service";
import { withBoundedAwait, createAsyncTelemetry } from "@/src/server/execution/cooperative-async.service";

describe("P0 lifecycle guardrail — AI STARTED orphan & stopRequested", () => {
  beforeEach(() => {
    resetAiRuntimeState();
    clearRoundCancellation("job-lifecycle");
  });

  it("1) AI starts normally", () => {
    beginAiBatch({ roundId: "1", runId: "r1", total: 1, concurrency: 1 });
    const row = startAiCandidate({ roundId: "1", runId: "r1", symbol: "BTCTRY" });
    expect(row.status).toBe("STARTED");
  });

  it("2) AI completes normally", () => {
    beginAiBatch({ roundId: "2", runId: "r2", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "2", runId: "r2", symbol: "ETHTRY" });
    const done = completeAiCandidate({ roundId: "2", runId: "r2", symbol: "ETHTRY" });
    expect(done?.status).toBe("COMPLETED");
  });

  it("3) AI fails", () => {
    beginAiBatch({ roundId: "3", runId: "r3", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "3", runId: "r3", symbol: "SOLTRY" });
    failAiCandidate({
      roundId: "3",
      runId: "r3",
      symbol: "SOLTRY",
      reasonCode: STALL_ERROR_CODES.AI_FAILED,
      errorType: "Error",
      reasonDetail: "provider failed",
    });
    expect(getAiBatchProgress("3", "r3")?.candidates[0]?.status).toBe("AI_FAILED");
  });

  it("4) AI times out", () => {
    beginAiBatch({ roundId: "4", runId: "r4", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "4", runId: "r4", symbol: "XRPTRY" });
    failAiCandidate({
      roundId: "4",
      runId: "r4",
      symbol: "XRPTRY",
      reasonCode: STALL_ERROR_CODES.AI_TIMEOUT,
      errorType: "Timeout",
      reasonDetail: "consensus timeout",
      timeout: true,
    });
    expect(getAiBatchProgress("4", "r4")?.candidates[0]?.status).toBe("AI_TIMEOUT");
  });

  it("5) stop requested while AI running", async () => {
    registerRoundCancellation("job-lifecycle");
    beginAiBatch({ roundId: "5", runId: "r5", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "5", runId: "r5", symbol: "ADATRY" });
    const pending = withBoundedAwait(
      "ai-running-stop",
      new Promise<string>(() => undefined),
      5_000,
      createAsyncTelemetry(),
      undefined,
      { signal: getRoundCancellationSignal("job-lifecycle") },
    );
    setTimeout(() => cancelRoundSelection("job-lifecycle", "stop requested"), 20);
    await expect(pending).rejects.toBeTruthy();
    cancelAiCandidate({
      roundId: "5",
      runId: "r5",
      symbol: "ADATRY",
      reasonCode: "AI_CANCELLED",
      reasonDetail: "stop requested",
    });
    expect(getAiBatchProgress("5", "r5")?.candidates[0]?.status).toBe("CANCELLED");
  });

  it("6) stop requested while AI queued", () => {
    beginAiBatch({ roundId: "6", runId: "r6", total: 2, concurrency: 1 });
    startAiCandidate({ roundId: "6", runId: "r6", symbol: "DOGETRY" });
    terminalizeOpenAiCandidates({
      roundId: "6",
      runId: "r6",
      reasonCode: "JOB_STOP_REQUESTED",
      cancelReason: "job stopped",
    });
    const batch = getAiBatchProgress("6", "r6");
    expect(batch?.processed).toBe(1);
    expect(batch?.candidates[0]?.status).toBe("CANCELLED");
  });

  it("7) stop requested during retry", async () => {
    registerRoundCancellation("job-lifecycle");
    beginAiBatch({ roundId: "7", runId: "r7", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "7", runId: "r7", symbol: "TRXTRY" });
    let attempts = 0;
    const signal = getRoundCancellationSignal("job-lifecycle");
    const retry = async () => {
      while (attempts < 3) {
        if (signal?.aborted) {
          cancelAiCandidate({
            roundId: "7",
            runId: "r7",
            symbol: "TRXTRY",
            reasonCode: "AI_CANCELLED",
            reasonDetail: "aborted before retry",
          });
          return;
        }
        attempts += 1;
        if (attempts === 1) cancelRoundSelection("job-lifecycle", "stop requested");
        await Promise.resolve();
      }
    };
    await retry();
    expect(attempts).toBe(1);
    expect(getAiBatchProgress("7", "r7")?.candidates[0]?.status).toBe("CANCELLED");
  });

  it("8) stop requested during remote provider wait", async () => {
    registerRoundCancellation("job-lifecycle");
    beginAiBatch({ roundId: "8", runId: "r8", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "8", runId: "r8", symbol: "BNBTRY" });
    const signal = getRoundCancellationSignal("job-lifecycle");
    const pending = withBoundedAwait("provider-wait", new Promise(() => undefined), 5_000, createAsyncTelemetry(), undefined, { signal });
    cancelRoundSelection("job-lifecycle", "provider wait stop");
    await expect(pending).rejects.toBeTruthy();
    cancelAiCandidate({
      roundId: "8",
      runId: "r8",
      symbol: "BNBTRY",
      reasonCode: "AI_CANCELLED",
      reasonDetail: "provider wait aborted",
    });
    expect(getAiBatchProgress("8", "r8")?.candidates[0]?.status).toBe("CANCELLED");
  });

  it("9) round terminalizes while AI STARTED", () => {
    beginAiBatch({ roundId: "9", runId: "r9", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "9", runId: "r9", symbol: "LINKTRY" });
    const closed = terminalizeOpenAiCandidates({
      roundId: "9",
      runId: "r9",
      reasonCode: "ROUND_FAILED",
      cancelReason: "round terminalized",
    });
    expect(closed).toHaveLength(1);
    expect(getAiBatchProgress("9", "r9")?.candidates[0]?.status).toBe("CANCELLED");
  });

  it("10) job terminalizes while AI STARTED", () => {
    beginAiBatch({ roundId: "10", runId: "r10", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "10", runId: "r10", symbol: "ATOMTRY" });
    terminalizeOpenAiCandidates({
      roundId: "10",
      runId: "r10",
      reasonCode: "JOB_STOP_REQUESTED",
      cancelReason: "job stopped",
    });
    expect(getAiBatchProgress("10", "r10")?.candidates[0]?.status).toBe("CANCELLED");
  });

  it("11) duplicate cancellation is idempotent", () => {
    beginAiBatch({ roundId: "11", runId: "r11", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "11", runId: "r11", symbol: "APTTRY" });
    const first = terminalizeOpenAiCandidates({
      roundId: "11",
      runId: "r11",
      reasonCode: "JOB_STOP_REQUESTED",
      cancelReason: "stop",
    });
    const second = terminalizeOpenAiCandidates({
      roundId: "11",
      runId: "r11",
      reasonCode: "JOB_STOP_REQUESTED",
      cancelReason: "stop",
    });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("12) delayed completion after cancellation does not reopen transition", () => {
    beginAiBatch({ roundId: "12", runId: "r12", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "12", runId: "r12", symbol: "NEARTRY" });
    terminalizeOpenAiCandidates({
      roundId: "12",
      runId: "r12",
      reasonCode: "JOB_STOP_REQUESTED",
      cancelReason: "stop",
    });
    const late = completeAiCandidate({ roundId: "12", runId: "r12", symbol: "NEARTRY" });
    expect(late).toBeNull();
    expect(getAiBatchProgress("12", "r12")?.processed).toBe(1);
  });

  it("13) persistence-race style late fail after completion is ignored", () => {
    beginAiBatch({ roundId: "13", runId: "r13", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "13", runId: "r13", symbol: "AVAXTRY" });
    completeAiCandidate({ roundId: "13", runId: "r13", symbol: "AVAXTRY" });
    const late = failAiCandidate({
      roundId: "13",
      runId: "r13",
      symbol: "AVAXTRY",
      reasonCode: STALL_ERROR_CODES.AI_FAILED,
      errorType: "LateWrite",
      reasonDetail: "late write",
    });
    expect(late).toBeNull();
    expect(getAiBatchProgress("13", "r13")?.candidates[0]?.status).toBe("COMPLETED");
  });

  it("14) orphan reconciliation terminalizes STARTED", () => {
    beginAiBatch({ roundId: "14", runId: "r14", total: 2, concurrency: 1 });
    startAiCandidate({ roundId: "14", runId: "r14", symbol: "SUIRTY" });
    terminalizeOpenAiCandidates({
      roundId: "14",
      runId: "r14",
      reasonCode: "RECONCILE_ORPHAN",
      cancelReason: "startup reconciliation",
    });
    const started = (getAiBatchProgress("14", "r14")?.candidates ?? []).filter((row) => row.status === "STARTED");
    expect(started).toHaveLength(0);
  });

  it("15) no STARTED remains after terminal state", () => {
    beginAiBatch({ roundId: "15", runId: "r15", total: 2, concurrency: 1 });
    startAiCandidate({ roundId: "15", runId: "r15", symbol: "XLMTRY" });
    startAiCandidate({ roundId: "15", runId: "r15", symbol: "FTMTRY" });
    terminalizeOpenAiCandidates({
      roundId: "15",
      runId: "r15",
      reasonCode: "ROUND_FAILED",
      cancelReason: "terminalized",
    });
    const started = (getAiBatchProgress("15", "r15")?.candidates ?? []).filter((row) => row.status === "STARTED");
    expect(started).toHaveLength(0);
  });

  it("16) no duplicate terminal transition", () => {
    beginAiBatch({ roundId: "16", runId: "r16", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "16", runId: "r16", symbol: "DOTTRY" });
    completeAiCandidate({ roundId: "16", runId: "r16", symbol: "DOTTRY" });
    const again = completeAiCandidate({ roundId: "16", runId: "r16", symbol: "DOTTRY" });
    expect(again).toBeNull();
    expect(getAiBatchProgress("16", "r16")?.processed).toBe(1);
  });

  it("17) no retry starts after stopRequested", () => {
    registerRoundCancellation("job-lifecycle");
    beginAiBatch({ roundId: "17", runId: "r17", total: 1, concurrency: 1 });
    startAiCandidate({ roundId: "17", runId: "r17", symbol: "OPTRY" });
    let startedAfterStop = false;
    cancelRoundSelection("job-lifecycle", "stop now");
    const signal = getRoundCancellationSignal("job-lifecycle");
    for (let i = 0; i < 3; i += 1) {
      if (signal?.aborted) break;
      startedAfterStop = true;
    }
    terminalizeOpenAiCandidates({
      roundId: "17",
      runId: "r17",
      reasonCode: "JOB_STOP_REQUESTED",
      cancelReason: "stop requested",
    });
    expect(startedAfterStop).toBe(false);
    expect(getAiBatchProgress("17", "r17")?.candidates[0]?.status).toBe("CANCELLED");
  });
});
