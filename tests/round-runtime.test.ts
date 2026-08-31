import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  RoundRuntimeController,
  cancelRoundSelection,
  readRuntimeFromMetadata,
  registerRoundCancellation,
} from "@/src/server/execution/round-runtime.service";
import { BoundedPrismaError } from "@/src/server/execution/bounded-prisma.service";
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

  it("keeps heartbeat non-fatal on bounded persistence timeout", async () => {
    const controller = new RoundRuntimeController(
      {
        jobId: "job-timeout",
        runId: "run-timeout",
        roundNo: 1,
        totalRounds: 3,
        selectionStartedAt: Date.now(),
        selectionBudgetMs: 60_000,
        selectionAttempt: 1,
        onPersist: async () => {
          throw new BoundedPrismaError("round-runtime.patchJobActiveRound timed out after 15000ms");
        },
      },
      3,
    );

    await expect(controller.heartbeat("hb")).resolves.toBeUndefined();
  });

  it("maps transition persistence timeout to abortable persist-timeout code", async () => {
    const controller = new RoundRuntimeController(
      {
        jobId: "job-transition-timeout",
        runId: "run-transition-timeout",
        roundNo: 1,
        totalRounds: 3,
        selectionStartedAt: Date.now(),
        selectionBudgetMs: 60_000,
        selectionAttempt: 1,
        onPersist: async () => {
          throw new BoundedPrismaError("round-runtime.mergeRunMetadata timed out after 15000ms");
        },
      },
      3,
    );

    await expect(controller.transition("SCANNING", "scanner step")).rejects.toMatchObject({
      name: "RoundSelectionAbortError",
      code: "PERSIST_TIMEOUT",
    });
  });

  it("serializes concurrent transition persists to avoid overlap", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const controller = new RoundRuntimeController(
      {
        jobId: "job-queue",
        runId: "run-queue",
        roundNo: 1,
        totalRounds: 3,
        selectionStartedAt: Date.now(),
        selectionBudgetMs: 60_000,
        selectionAttempt: 1,
        onPersist: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 20));
          inFlight -= 1;
        },
      },
      3,
    );

    await Promise.all([
      controller.transition("PUMP_SCAN", "pump"),
      controller.transition("SCANNING", "scan"),
      controller.transition("AI_ANALYSIS", "ai"),
    ]);
    expect(maxInFlight).toBe(1);
  });
});
