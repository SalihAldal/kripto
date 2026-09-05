import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordPaperFillEvent: vi.fn(),
  markPaperPersistenceReconciliation: vi.fn(),
}));

vi.mock("@/src/server/paper-validation/paper-trade-recorder.service", () => ({
  recordPaperFillEvent: mocks.recordPaperFillEvent,
}));

vi.mock("@/src/server/execution/paper-persistence-reconciliation.service", () => ({
  markPaperPersistenceReconciliation: mocks.markPaperPersistenceReconciliation,
}));

describe("P0 paper close persistence contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordPaperFillEvent.mockResolvedValue({ tradeId: "paper-trade-1", action: "CLOSE" });
    mocks.markPaperPersistenceReconciliation.mockResolvedValue({ positionMarked: true, reconciliationPersisted: true });
  });

  it("persists SELL close directly from settlement flow", async () => {
    const { persistPaperCloseFillForSettlement } = await import(
      "@/src/server/execution/paper-close-persistence.service"
    );
    const result = await persistPaperCloseFillForSettlement({
      executionId: "execution-1",
      userId: "user-1",
      symbol: "BTCTRY",
      quantity: 1,
      avgFillPrice: 101,
      fee: 0.1,
      simulationId: "sim-1",
      campaignId: "cmp-1",
      candidateId: "cand-1",
      orderId: "order-1",
      positionId: "position-1",
      runId: "run-1",
      roundId: "round-1",
    });

    expect(result).toEqual({ persisted: true, skipped: false });
    expect(mocks.recordPaperFillEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        side: "SELL",
        executionId: "execution-1",
        simulationId: "sim-1",
        positionId: "position-1",
      }),
    );
    expect(mocks.markPaperPersistenceReconciliation).not.toHaveBeenCalled();
  });

  it("marks reconciliation and fails fast when SELL close persistence fails", async () => {
    mocks.recordPaperFillEvent.mockRejectedValueOnce(new Error("Prisma P1001 database unavailable"));
    const { persistPaperCloseFillForSettlement } = await import(
      "@/src/server/execution/paper-close-persistence.service"
    );

    await expect(
      persistPaperCloseFillForSettlement({
        executionId: "execution-2",
        userId: "user-2",
        symbol: "ETHTRY",
        quantity: 2,
        avgFillPrice: 55,
        fee: 0.2,
        simulationId: "sim-2",
        campaignId: "cmp-2",
        candidateId: "cand-2",
        orderId: "order-2",
        positionId: "position-2",
      }),
    ).rejects.toThrow("DATABASE:DATABASE_FAILURE");

    expect(mocks.markPaperPersistenceReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: "execution-2",
        symbol: "ETHTRY",
        side: "SELL",
        simulationId: "sim-2",
      }),
    );
  });
});
