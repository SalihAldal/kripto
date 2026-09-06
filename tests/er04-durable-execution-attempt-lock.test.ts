import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    appSetting: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      deleteMany: mocks.deleteMany,
    },
  },
}));

describe("ER04 durable execution attempt lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "setting-1" });
    mocks.findUnique.mockResolvedValue(null);
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("claims a durable candidate lock once", async () => {
    const { claimDurableCanonicalExecutionAttempt } = await import(
      "@/src/server/hot-path/execution-attempt-lock.service"
    );
    const first = await claimDurableCanonicalExecutionAttempt({
      userId: "u-1",
      candidateId: "btc:1",
      executionId: "exec-1",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(first.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("returns DUPLICATE_EXECUTION_PATH on concurrent/duplicate claim", async () => {
    const { claimDurableCanonicalExecutionAttempt } = await import(
      "@/src/server/hot-path/execution-attempt-lock.service"
    );
    mocks.create.mockRejectedValueOnce(new Error("unique violation"));
    mocks.findUnique.mockResolvedValueOnce({
      value: {
        candidateId: "BTC:1",
        executionId: "exec-existing",
        executionState: "IN_PROGRESS",
      },
    });
    const second = await claimDurableCanonicalExecutionAttempt({
      userId: "u-1",
      candidateId: "btc:1",
      executionId: "exec-2",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("DUPLICATE_EXECUTION_PATH");
    expect(second.existingExecutionId).toBe("exec-existing");
  });

  it("releases durable lock by the same composite key", async () => {
    const { releaseDurableCanonicalExecutionAttempt } = await import(
      "@/src/server/hot-path/execution-attempt-lock.service"
    );
    await releaseDurableCanonicalExecutionAttempt({
      userId: "u-1",
      candidateId: "btc:1",
      executionMode: "paper",
      venue: "BINANCE_TR",
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "u-1",
          key: expect.stringContaining("execution.attempt.lock.u-1.PAPER.BINANCE_TR.BTC:1"),
        }),
      }),
    );
  });
});
