import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAccountBalances: vi.fn(),
  getTicker: vi.fn(),
  getPaperAccount: vi.fn(),
  evaluateClockSync: vi.fn(),
  persistClockSyncForensics: vi.fn(),
}));

vi.mock("@/services/binance.service", () => ({
  getAccountBalances: mocks.getAccountBalances,
  getTicker: mocks.getTicker,
}));

vi.mock("@/src/server/simulation/paper-trading.service", () => ({
  getPaperAccount: mocks.getPaperAccount,
}));

vi.mock("@/src/server/execution-safety/clock-sync.service", () => ({
  evaluateClockSync: mocks.evaluateClockSync,
  persistClockSyncForensics: mocks.persistClockSyncForensics,
  MAX_CLOCK_SKEW_MS: 5_000,
}));

vi.mock("@/src/server/resilience/circuit-breaker", () => ({
  getCircuitSnapshot: () => [],
}));

describe("P0 paper/live dependency isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaperAccount.mockResolvedValue({ balances: { TRY: 10_000, BTC: 0 } });
    mocks.getTicker.mockResolvedValue({ symbol: "BTCTRY", price: 100 });
  });

  it("paper balance validation never calls live account balances", async () => {
    const { resolveBalancesForMode } = await import(
      "@/src/server/execution-management/balance-resolver.service"
    );
    const balances = await resolveBalancesForMode({
      userId: "user-1",
      mode: "paper",
      quoteAsset: "TRY",
      baseAsset: "BTC",
    });
    expect(balances.availableQuote).toBe(10_000);
    expect(mocks.getAccountBalances).not.toHaveBeenCalled();
  });

  it("paper API health validates price without live clock-sync dependency", async () => {
    const { validateApiHealth } = await import(
      "@/src/server/execution-safety/api-health-validation.service"
    );
    const result = await validateApiHealth({
      executionId: "execution-1",
      userId: "user-1",
      symbol: "BTCTRY",
      side: "BUY",
      mode: "paper",
      quantity: 1,
      priceHint: 100,
      quoteAsset: "TRY",
      baseAsset: "BTC",
      openPositionCount: 0,
      allowMultipleOpenPositions: true,
    });
    expect(result.passed).toBe(true);
    expect(result.metadata?.clockSyncRequired).toBe(false);
    expect(mocks.evaluateClockSync).not.toHaveBeenCalled();
  });
});
