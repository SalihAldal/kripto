import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  assertNoSilentCandidateLoss,
  getCandidateLifecycleLog,
  recordCandidateLifecycle,
  resetCandidateLifecycleLog,
  traceCandidateReject,
} from "@/src/server/forensics/candidate-lifecycle.service";
import { clearForensicSession, ensureForensicSession } from "@/src/server/forensics/forensic-context";
import {
  resetPumpScanLifecycleEvents,
  runBoundedLivePumpScan,
} from "@/src/server/scanner/pump-scan-lifecycle.service";
import {
  CooperativeAsyncTimeoutError,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";

vi.mock("@/src/server/execution/cooperative-async.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/server/execution/cooperative-async.service")>();
  return {
    ...actual,
    withBoundedAwait: vi.fn(actual.withBoundedAwait),
  };
});

describe("silent rejection sweep", () => {
  beforeEach(() => {
    resetCandidateLifecycleLog();
    clearForensicSession();
    ensureForensicSession({ sessionId: "sweep-test", runId: "run-1" });
  });

  it("records terminal outcome for every traced rejection", () => {
    traceCandidateReject({
      symbol: "AVNTTRY",
      stage: "scanner",
      reasonCode: "TAPE_YETERSIZ",
      reasonDetail: "tape below threshold",
    });
    traceCandidateReject({
      symbol: "ATMTRY",
      stage: "decision",
      reasonCode: "SIM_TIGHT_FILTER",
      reasonDetail: "quality score too low",
    });
    const records = getCandidateLifecycleLog("run-1");
    expect(records.length).toBe(2);
    expect(assertNoSilentCandidateLoss(records)).toBe(true);
    expect(records.every((row) => row.verdict === "REJECTED")).toBe(true);
  });

  it("never leaves UNKNOWN without explicit reason fields", () => {
    recordCandidateLifecycle({
      symbol: "GUNTRY",
      stage: "ai",
      verdict: "UNKNOWN",
      reasonCode: "AI_ANALYSIS_INCOMPLETE",
      reasonDetail: "consensus stalled at 2/40",
    });
    const records = getCandidateLifecycleLog();
    expect(assertNoSilentCandidateLoss(records)).toBe(true);
    expect(records[0]?.reasonCode).toBe("AI_ANALYSIS_INCOMPLETE");
  });
});

describe("pump scan hang regression", () => {
  beforeEach(() => {
    resetCandidateLifecycleLog();
    resetPumpScanLifecycleEvents();
  });

  it("maps unbounded live pump scan timeout to PUMP_SCAN_FAILED", async () => {
    vi.mocked(withBoundedAwait).mockRejectedValueOnce(
      new CooperativeAsyncTimeoutError("resolveLiveTopGainerPumpCandidates timed out after 90000ms"),
    );
    const task = Promise.resolve(["NEVER_RUNS"]);
    await expect(runBoundedLivePumpScan("hang-repro", () => task, { scope: "live" })).rejects.toMatchObject({
      code: "PUMP_SCAN_FAILED",
      blockKind: "timer",
    });
    const lifecycle = getCandidateLifecycleLog();
    expect(assertNoSilentCandidateLoss(lifecycle)).toBe(true);
    expect(lifecycle.some((row) => row.symbol === "PUMP_SCAN" && row.reasonCode === "PUMP_SCAN_FAILED")).toBe(true);
  });
});
