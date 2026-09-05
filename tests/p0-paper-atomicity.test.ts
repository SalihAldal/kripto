import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyExecutionFailure } from "@/src/server/execution/execution-failure-contract";

const atomicityMocks = vi.hoisted(() => ({
  updatePositionMetadata: vi.fn(),
  persistExecutionReconciliation: vi.fn(),
  publishExecutionEvent: vi.fn(),
}));

vi.mock("@/src/server/repositories/execution.repository", () => ({
  updatePositionMetadata: atomicityMocks.updatePositionMetadata,
}));

vi.mock("@/src/server/execution-engine-v2/execution-engine-v2.repository", () => ({
  persistExecutionReconciliation: atomicityMocks.persistExecutionReconciliation,
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: atomicityMocks.publishExecutionEvent,
}));

describe("P0 paper post-fill persistence atomicity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    atomicityMocks.updatePositionMetadata.mockResolvedValue({ id: "position-1" });
    atomicityMocks.persistExecutionReconciliation.mockResolvedValue({ id: "reconcile-1" });
  });

  it("marks the orphan position and persists reconciliation requirement", async () => {
    const { markPaperPersistenceReconciliation } = await import(
      "@/src/server/execution/paper-persistence-reconciliation.service"
    );
    const failure = classifyExecutionFailure(new Error("Prisma P1001 database persistence failure"), {
      operation: "persist_paper_fill",
      dependency: "paper_trade_repository",
      domainHint: "DATABASE",
    });

    const result = await markPaperPersistenceReconciliation({
      executionId: "execution-1",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 0.01,
      positionId: "position-1",
      orderId: "order-1",
      simulationId: "simulation-1",
      candidateId: "candidate-1",
      campaignId: "campaign-1",
      runId: "run-1",
      roundId: "round-1",
      failure,
    });

    expect(result).toEqual({ positionMarked: true, reconciliationPersisted: true });
    expect(atomicityMocks.updatePositionMetadata).toHaveBeenCalledWith(
      "position-1",
      expect.objectContaining({
        paperPersistenceState: "RECONCILIATION_REQUIRED",
        paperPersistenceFailure: "DATABASE:DATABASE_FAILURE",
      }),
    );
    expect(atomicityMocks.persistExecutionReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "execution-1",
        status: "MISMATCH",
        repairAction: "REPLAY_PAPER_FILL_PERSISTENCE",
        metadata: expect.objectContaining({
          positionId: "position-1",
          simulationId: "simulation-1",
          candidateId: "candidate-1",
        }),
      }),
    );
    expect(atomicityMocks.publishExecutionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "PAPER_FILL_RECONCILIATION_REQUIRED",
        status: "FAILED",
        context: expect.objectContaining({
          failureDomain: "DATABASE",
          positionMarked: true,
          reconciliationPersisted: true,
        }),
      }),
    );
  });

  it("does not hide a secondary reconciliation persistence outage", async () => {
    atomicityMocks.updatePositionMetadata.mockRejectedValueOnce(new Error("database unavailable"));
    atomicityMocks.persistExecutionReconciliation.mockRejectedValueOnce(new Error("database unavailable"));
    const { markPaperPersistenceReconciliation } = await import(
      "@/src/server/execution/paper-persistence-reconciliation.service"
    );
    const failure = classifyExecutionFailure(new Error("database persistence failure"), {
      operation: "persist_paper_fill",
      dependency: "paper_trade_repository",
      domainHint: "DATABASE",
    });

    const result = await markPaperPersistenceReconciliation({
      executionId: "execution-2",
      symbol: "ETHUSDT",
      side: "BUY",
      quantity: 0.1,
      positionId: "position-2",
      orderId: "order-2",
      simulationId: "simulation-2",
      candidateId: "candidate-2",
      failure,
    });

    expect(result).toEqual({ positionMarked: false, reconciliationPersisted: false });
    expect(atomicityMocks.publishExecutionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          positionMarked: false,
          reconciliationPersisted: false,
        }),
      }),
    );
  });
});
