import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  upsertPaperTrade: vi.fn(),
  createPaperExecution: vi.fn(),
  simulationFindUnique: vi.fn(),
  positionFindFirst: vi.fn(),
  decisionFindFirst: vi.fn(),
  paperTradeFindFirst: vi.fn(),
}));

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    executionSimulation: { findUnique: mocks.simulationFindUnique },
    position: { findFirst: mocks.positionFindFirst },
    decisionLog: { findFirst: mocks.decisionFindFirst },
    paperTrade: { findFirst: mocks.paperTradeFindFirst },
  },
}));

vi.mock("@/src/server/paper-validation/paper-validation.repository", () => ({
  upsertPaperTrade: mocks.upsertPaperTrade,
  createPaperExecution: mocks.createPaperExecution,
}));

describe("P0 paper fill persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.simulationFindUnique.mockResolvedValue({
      requestedQty: 2,
      requestedPrice: 100,
      totalSlippagePct: 0.05,
      executionDurationMs: 12,
      fillCount: 1,
      slippage: { spreadPct: 0.1, midPrice: 100 },
      quality: { overallScore: 90, slippageScore: 90, fillScore: 90, latencyScore: 90 },
      comparison: { requestedPrice: 100, executedPrice: 100.1, bestPossiblePrice: 100 },
      latency: { totalMs: 12 },
    });
    mocks.positionFindFirst.mockResolvedValue({ id: "position-1", tradingPair: { symbol: "BTCTRY" } });
    mocks.decisionFindFirst.mockResolvedValue(null);
    mocks.upsertPaperTrade.mockResolvedValue({ id: "paper-trade-1" });
    mocks.createPaperExecution.mockResolvedValue({ id: "paper-execution-1" });
  });

  it("simulated BUY fill persists PaperTrade and PaperExecution with campaign identity", async () => {
    const { recordPaperFillEvent } = await import(
      "@/src/server/paper-validation/paper-trade-recorder.service"
    );
    const result = await recordPaperFillEvent({
      campaignId: "cmp:p0-smoke",
      userId: "user-1",
      simulationId: "simulation-1",
      executionId: "execution-1",
      positionId: "position-1",
      symbol: "BTCTRY",
      side: "BUY",
      executedQty: 2,
      avgFillPrice: 100.1,
      fee: 0.2,
      fillCount: 1,
    });

    expect(result).toEqual({ tradeId: "paper-trade-1", action: "OPEN" });
    expect(mocks.upsertPaperTrade).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "cmp:p0-smoke",
        executionId: "execution-1",
        positionId: "position-1",
        simulationId: "simulation-1",
        status: "OPEN",
      }),
    );
    expect(mocks.createPaperExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "cmp:p0-smoke",
        paperTradeId: "paper-trade-1",
        executionId: "execution-1",
        simulationId: "simulation-1",
      }),
    );
    expect(mocks.positionFindFirst).not.toHaveBeenCalled();
  });
});
