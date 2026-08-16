import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  RoundRuntimeController,
  cancelRoundSelection,
  readRuntimeFromMetadata,
  registerRoundCancellation,
} from "@/src/server/execution/round-runtime.service";
import { RoundSelectionAbortError } from "@/src/server/execution/round-runtime.types";

vi.mock("@/src/server/repositories/auto-round.repository", () => ({
  getAutoRoundJobById: vi.fn(async () => ({
    id: "job-1",
    metadata: {},
    activeState: "tariyor",
  })),
  getAutoRoundRunById: vi.fn(async () => ({
    id: "run-1",
    metadata: {},
  })),
  updateAutoRoundJob: vi.fn(async (payload: Record<string, unknown>) => payload),
  updateAutoRoundRun: vi.fn(async (payload: Record<string, unknown>) => payload),
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: vi.fn(),
}));

vi.mock("@/src/server/observability/structured-log", () => ({
  writeStructuredLog: vi.fn(async () => null),
}));

describe("round runtime controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists granular step transitions immediately", async () => {
    const persisted: Array<Record<string, unknown>> = [];
    const controller = new RoundRuntimeController(
      {
        jobId: "job-1",
        runId: "run-1",
        roundNo: 1,
        totalRounds: 10,
        selectionStartedAt: Date.now(),
        selectionBudgetMs: 60_000,
        selectionAttempt: 1,
        onPersist: async (snapshot) => {
          persisted.push(snapshot as unknown as Record<string, unknown>);
        },
      },
      3,
    );

    await controller.transition("PUMP_SCAN", "Pump scan started");
    await controller.transition("AI_ANALYSIS", "AI running", { currentSymbol: "BTCTRY" });

    expect(persisted.length).toBeGreaterThanOrEqual(2);
    expect(persisted.at(-1)?.step).toBe("AI_ANALYSIS");
    expect(persisted.at(-1)?.currentSymbol).toBe("BTCTRY");
  });

  it("enforces selection budget continuously", async () => {
    const controller = new RoundRuntimeController(
      {
        jobId: "job-2",
        runId: "run-2",
        roundNo: 1,
        totalRounds: 5,
        selectionStartedAt: Date.now() - 5_000,
        selectionBudgetMs: 1_000,
        selectionAttempt: 1,
      },
      3,
    );

    expect(() => controller.checkBudget(true)).toThrow(RoundSelectionAbortError);
  });

  it("supports cancellation via abort controller", () => {
    registerRoundCancellation("job-3");
    expect(cancelRoundSelection("job-3", "manual stop")).toBe(true);
    const signal = registerRoundCancellation("job-3");
    expect(signal.signal.aborted).toBe(true);
  });

  it("reads runtime snapshot from metadata", () => {
    const snapshot = readRuntimeFromMetadata({
      runtime: {
        step: "SCANNING",
        message: "scanning",
        coarseState: "tariyor",
        candidatesProcessed: 2,
        retryCount: 1,
        selectionAttempt: 1,
        roundProgressPct: 12,
        elapsedMs: 1000,
        selectionBudgetMs: 120000,
        heartbeatAt: new Date().toISOString(),
        timeline: [],
      },
    });
    expect(snapshot?.step).toBe("SCANNING");
  });
});
