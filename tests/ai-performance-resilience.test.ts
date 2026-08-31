import { beforeEach, describe, expect, it, vi } from "vitest";

const listRecentAiPerformance = vi.fn();
const listPendingAiPerformance = vi.fn();

vi.mock("@/src/server/repositories/ai-performance.repository", () => ({
  addAiPerformanceMemory: vi.fn(),
  listPendingAiPerformance: (...args: unknown[]) => listPendingAiPerformance(...args),
  listRecentAiPerformance: (...args: unknown[]) => listRecentAiPerformance(...args),
  updateAiPerformanceMemory: vi.fn(),
}));

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    tradingPair: { findFirst: vi.fn(async () => null) },
    marketSnapshot: { findFirst: vi.fn(async () => null) },
  },
}));

describe("ai performance db resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty weights when recent-memory read has transient P1001", async () => {
    listRecentAiPerformance.mockRejectedValue(new Error("P1001 Can't reach database server"));
    const { getAiProviderWeights } = await import("@/src/server/ai/ai-performance.service");
    const weights = await getAiProviderWeights("user-1");
    expect(weights).toEqual({});
  });

  it("skips evaluation when pending-memory read has transient P1002", async () => {
    listPendingAiPerformance.mockRejectedValue(new Error("P1002 timeout while connecting"));
    const { evaluateAiPerformanceMemory } = await import("@/src/server/ai/ai-performance.service");
    await expect(evaluateAiPerformanceMemory("user-1")).resolves.toBeUndefined();
  });
});
