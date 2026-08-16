import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  beginAiBatch,
  completeAiCandidate,
  failAiCandidate,
  getAiBatchProgress,
  resetAiRuntimeState,
  startAiCandidate,
} from "@/src/server/forensics/ai-runtime.service";
import {
  CooperativeAsyncTimeoutError,
  resolveScannerAiWorkerTimeoutMs,
  startRoundSelectionWatchdog,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";
import {
  evaluateRoundProgressStall,
  recordRoundWatchdogDecision,
  resolveRoundProgressStaleMs,
} from "@/src/server/forensics/round-progress-watchdog.service";
import {
  getTransactionDurationLog,
  resetTransactionTelemetry,
  runInstrumentedTransaction,
} from "@/src/server/forensics/transaction-telemetry.service";
import { mapRecoveryToTerminalReason, recordRecoveryTelemetry, resetRecoveryTelemetry } from "@/src/server/forensics/recovery-telemetry.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import { prisma } from "@/src/server/db/prisma";

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

describe("P1 AI bounded execution", () => {
  beforeEach(() => {
    resetAiRuntimeState();
  });

  it("records AI_FAILED with reason fields when candidate fails", () => {
    beginAiBatch({ roundId: "13", runId: "run-13", total: 40, concurrency: 8 });
    startAiCandidate({ roundId: "13", runId: "run-13", symbol: "GUNTRY", stage: "consensus", timeoutMs: 90_000 });
    failAiCandidate({
      roundId: "13",
      runId: "run-13",
      symbol: "GUNTRY",
      reasonCode: STALL_ERROR_CODES.AI_TIMEOUT,
      errorType: "CooperativeAsyncTimeoutError",
      reasonDetail: "ai-consensus:GUNTRY timed out after 90000ms",
      timeout: true,
    });
    const batch = getAiBatchProgress("13", "run-13");
    expect(batch?.processed).toBe(1);
    expect(batch?.timeoutCount).toBe(1);
    expect(batch?.candidates[0]?.status).toBe("AI_TIMEOUT");
    expect(batch?.candidates[0]?.reasonCode).toBe(STALL_ERROR_CODES.AI_TIMEOUT);
  });

  it("persists incremental ai-progress counters", () => {
    beginAiBatch({ roundId: "13", total: 3, concurrency: 2 });
    startAiCandidate({ roundId: "13", symbol: "A", stage: "ai" });
    completeAiCandidate({ roundId: "13", symbol: "A", status: "COMPLETED" });
    startAiCandidate({ roundId: "13", symbol: "B", stage: "ai" });
    failAiCandidate({
      roundId: "13",
      symbol: "B",
      reasonCode: STALL_ERROR_CODES.AI_FAILED,
      errorType: "Error",
      reasonDetail: "provider unavailable",
    });
    const batch = getAiBatchProgress("13");
    expect(batch?.processed).toBe(2);
    expect(batch?.successCount).toBe(1);
    expect(batch?.failedCount).toBe(1);
    expect(batch?.lastProgressAt).toBeTruthy();
  });

  it("aligns scanner AI worker timeout with per-step budgets", () => {
    const workerTimeout = resolveScannerAiWorkerTimeoutMs();
    expect(workerTimeout).toBeGreaterThanOrEqual(120_000);
  });
});

describe("P1 round progress watchdog", () => {
  it("flags stall when heartbeat continues but progress is frozen", () => {
    const staleAt = new Date(Date.now() - resolveRoundProgressStaleMs() - 5_000).toISOString();
    const freshHeartbeat = new Date().toISOString();
    const record = evaluateRoundProgressStall({
      roundId: "13",
      lastProgressAt: staleAt,
      lastHeartbeatAt: freshHeartbeat,
      currentStage: "AI_ANALYSIS",
      workerAlive: true,
    });
    expect(record.decision).toBe("FAIL_ROUND");
    expect(record.action).toBe(STALL_ERROR_CODES.ROUND_STALLED);
  });

  it("does not flag legitimate position monitoring as stalled", () => {
    const staleAt = new Date(Date.now() - 600_000).toISOString();
    const record = evaluateRoundProgressStall({
      roundId: "13",
      lastProgressAt: staleAt,
      currentStage: "POSITION_MONITORING",
      workerAlive: true,
    });
    expect(record.decision).toBe("NONE");
  });
});

describe("P1 recovery telemetry", () => {
  beforeEach(() => resetRecoveryTelemetry());

  it("maps escalation stop to RECOVERY_EXHAUSTED terminal reason", () => {
    const mapped = mapRecoveryToTerminalReason({ action: "STOP_JOB", escalationLevel: 5 });
    expect(mapped?.terminalReason).toBe(STALL_ERROR_CODES.RECOVERY_EXHAUSTED);
    expect(mapped?.terminalState).toBe("STOPPED");
  });

  it("records recovery escalation metadata", () => {
    recordRecoveryTelemetry({
      jobId: "job-1",
      runId: "run-14",
      action: "FAIL_CURRENT_ROUND",
      escalationCount: 4,
      lastRecoveryReason: "Repeated runtime failures — fail current round",
      terminalState: "FAILED",
      terminalReason: STALL_ERROR_CODES.ROUND_STALLED,
    });
    expect(mapRecoveryToTerminalReason({ action: "FAIL_CURRENT_ROUND", escalationLevel: 4 })?.terminalState).toBe("FAILED");
  });
});

describe("P1 transaction telemetry", () => {
  beforeEach(() => {
    resetTransactionTelemetry();
    vi.mocked(prisma.$transaction).mockReset();
  });

  it("classifies slow and timed out DB transactions", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("Transaction already closed: timeout was 5000 ms"));
    await expect(runInstrumentedTransaction("auto-round.mergeRunMetadata", async () => null)).rejects.toThrow(/timeout/i);
    const row = getTransactionDurationLog().slice(-1)[0];
    expect(row?.classification).toBe("TIMEOUT");
    expect(row?.errorType).toBe(STALL_ERROR_CODES.DB_TRANSACTION_TIMEOUT);
  });
});

describe("P1 terminal round guarantee", () => {
  it("bounded await prevents synthetic hung AI from running forever", async () => {
    vi.useFakeTimers();
    const pending = withBoundedAwait(
      "terminal-guarantee",
      new Promise<string>(() => undefined),
      50,
    );
    const rejection = expect(pending).rejects.toBeInstanceOf(CooperativeAsyncTimeoutError);
    await vi.advanceTimersByTimeAsync(60);
    await rejection;
    vi.useRealTimers();
  });

  it("selection watchdog fires on progress stall before heartbeat-only masking", async () => {
    vi.useFakeTimers();
    const onStale = vi.fn();
    startRoundSelectionWatchdog({
      jobId: "job-1",
      getLastHeartbeatAt: () => new Date().toISOString(),
      getLastProgressAt: () => new Date(Date.now() - 300_000).toISOString(),
      progressStaleMs: 60_000,
      pollMs: 1_000,
      onStale,
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(onStale).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
