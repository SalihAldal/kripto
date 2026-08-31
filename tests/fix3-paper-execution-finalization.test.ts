import { describe, expect, it, vi, beforeEach } from "vitest";
import { walkOrderBook } from "@/src/server/exchange-simulator/slippage-engine";
import { buildIdempotencyKey } from "@/src/server/execution-engine-v2/idempotency.service";
import { resolveExecutionAdapter } from "@/src/server/paper-runtime/execution-port";

const marketMocks = vi.hoisted(() => ({
  getTicker: vi.fn(),
  getOrderBook: vi.fn(),
}));

vi.mock("@/services/binance.service", () => ({
  getTicker: marketMocks.getTicker,
  getOrderBook: marketMocks.getOrderBook,
}));

vi.mock("@/src/server/exchange-simulator/exchange-simulator.repository", () => ({
  persistExecutionSimulation: vi.fn(async () => null),
}));

vi.mock("@/src/server/exchange-simulator/exchange-filter-engine", () => ({
  validateSimulationFilters: vi.fn(async (input: { quantity: number }) => ({
    ok: true,
    filter: {
      adjustedQuantity: input.quantity,
      adjustedPrice: 0,
      minNotional: 0,
      reasons: [],
      ok: true,
    },
  })),
}));

vi.mock("@/src/server/exchange-simulator/latency-simulator", () => ({
  simulateLatency: () => ({ networkMs: 0, exchangeMs: 0, queueMs: 0, matchingMs: 0, totalMs: 0 }),
  applyLatencyDelay: vi.fn(async () => undefined),
  analyzeLatencySamples: vi.fn(),
}));

vi.mock("@/src/server/market-data/spine/market-data-daemon", () => ({
  getMarketDataDaemon: () => ({
    getLatest: () => null,
    isFresh: () => true,
  }),
}));

describe("fix3 paper execution finalization", () => {
  beforeEach(() => {
    marketMocks.getTicker.mockReset();
    marketMocks.getOrderBook.mockReset();
  });

  it("depth walk does not fabricate missing liquidity", () => {
    const walk = walkOrderBook({
      side: "BUY",
      quantity: 100,
      levels: [
        { price: 100, quantity: 10 },
        { price: 101, quantity: 20 },
        { price: 102, quantity: 30 },
      ],
      referencePrice: 100,
    });
    expect(walk.executedQty).toBe(60);
    expect(walk.remainingQty).toBe(40);
    expect(walk.fills).toHaveLength(3);
    expect(walk.avgFillPrice).toBeCloseTo((10 * 100 + 20 * 101 + 30 * 102) / 60, 8);
  });

  it("candidate-based idempotency key is deterministic", () => {
    const keyA = buildIdempotencyKey({
      userId: "u1",
      symbol: "BTCUSDT",
      side: "BUY",
      candidateId: "cand-1",
      scope: "ENTRY",
    });
    const keyB = buildIdempotencyKey({
      userId: "u1",
      symbol: "BTCUSDT",
      side: "BUY",
      candidateId: "cand-1",
      scope: "ENTRY",
    });
    expect(keyA).toBe(keyB);
    expect(keyA).toContain("cand-1");
  });

  it("execution port resolves canonical paper adapter", () => {
    const adapter = resolveExecutionAdapter("paper");
    expect(adapter.kind).toBe("PAPER");
  });

  it("simulator rejects stale/empty book instead of fake fill", async () => {
    marketMocks.getTicker.mockResolvedValue({ symbol: "BTCUSDT", price: 100, change24h: 0, volume24h: 1_000_000 });
    marketMocks.getOrderBook.mockResolvedValue({ bids: [], asks: [] });
    const { simulateMarketExecution } = await import("@/src/server/exchange-simulator/exchange-simulator.service");
    const result = await simulateMarketExecution({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 10,
      priceHint: 100,
      quoteAsset: "USDT",
      baseAsset: "BTC",
    });
    expect(result.ok).toBe(false);
    expect(result.rejectReason).toBe("PAPER_EXECUTION_DATA_STALE");
  });

  it("simulator uses order book sides and supports partial fill", async () => {
    marketMocks.getTicker.mockResolvedValue({ symbol: "BTCUSDT", price: 100, change24h: 0, volume24h: 1_000_000 });
    marketMocks.getOrderBook.mockResolvedValue({
      bids: [{ price: 99, quantity: 15 }],
      asks: [{ price: 101, quantity: 30 }],
    });
    const { simulateMarketExecution } = await import("@/src/server/exchange-simulator/exchange-simulator.service");
    const buy = await simulateMarketExecution({
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 50,
      priceHint: 100,
      quoteAsset: "USDT",
      baseAsset: "BTC",
    });
    expect(buy.ok).toBe(true);
    expect(buy.status).toBe("PARTIALLY_FILLED");
    expect(buy.executedQty).toBe(30);
    expect(buy.avgFillPrice).toBeGreaterThanOrEqual(101);

    const sell = await simulateMarketExecution({
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: 20,
      priceHint: 100,
      quoteAsset: "USDT",
      baseAsset: "BTC",
    });
    expect(sell.ok).toBe(true);
    expect(sell.executedQty).toBe(15);
    expect(sell.avgFillPrice).toBeLessThanOrEqual(99);
  });
});
