import { describe, expect, it, vi, beforeEach } from "vitest";
import { marketDataOrchestrator, resolveAdaptiveTtlMs } from "@/src/server/market-data/market-data-orchestrator.service";

const providerMocks = vi.hoisted(() => ({
  getTicker: vi.fn(),
  getKlines: vi.fn(),
  getOrderBook: vi.fn(),
  getRecentTrades: vi.fn(),
  getExchangeInfo: vi.fn(),
}));

vi.mock("@/src/server/exchange", () => ({
  getExchangeProvider: () => providerMocks,
}));

describe("market data orchestrator", () => {
  beforeEach(() => {
    marketDataOrchestrator.resetTelemetry();
    providerMocks.getTicker.mockReset();
    providerMocks.getKlines.mockReset();
    providerMocks.getOrderBook.mockReset();
    providerMocks.getRecentTrades.mockReset();
    providerMocks.getExchangeInfo.mockReset();
    providerMocks.getTicker.mockResolvedValue({
      symbol: "BTCTRY",
      price: 100,
      change24h: 1.2,
      volume24h: 10_000_000,
    });
    providerMocks.getKlines.mockResolvedValue([{ open: 99, high: 101, low: 98, close: 100, volume: 10, openTime: 1, closeTime: 2 }]);
    providerMocks.getOrderBook.mockResolvedValue({
      lastUpdateId: 1,
      bids: [{ price: 99.9, quantity: 1 }],
      asks: [{ price: 100.1, quantity: 1 }],
    });
    providerMocks.getRecentTrades.mockResolvedValue([{ id: 1, price: 100, qty: 1, time: Date.now(), isBuyerMaker: false }]);
  });

  it("resolves adaptive TTL dynamically by volume tier", () => {
    const high = resolveAdaptiveTtlMs({ kind: "ticker", volume24h: 8_000_000, priority: "normal" });
    const low = resolveAdaptiveTtlMs({ kind: "ticker", volume24h: 100_000, priority: "normal" });
    expect(high).toBeLessThan(low);
  });

  it("coalesces duplicate in-flight ticker requests", async () => {
    const [a, b] = await Promise.all([
      marketDataOrchestrator.getTicker("BTCTRY", { priority: "normal" }),
      marketDataOrchestrator.getTicker("BTCTRY", { priority: "normal" }),
    ]);
    expect(a.symbol).toBe("BTCTRY");
    expect(b.symbol).toBe("BTCTRY");
    expect(providerMocks.getTicker).toHaveBeenCalledTimes(1);
    const telemetry = marketDataOrchestrator.getTelemetry();
    expect(telemetry.coalescedHits).toBeGreaterThan(0);
  });

  it("serves cache on repeated reads without extra exchange calls", async () => {
    await marketDataOrchestrator.getTicker("BTCTRY", { priority: "normal" });
    await marketDataOrchestrator.getTicker("BTCTRY", { priority: "normal" });
    expect(providerMocks.getTicker).toHaveBeenCalledTimes(1);
    const telemetry = marketDataOrchestrator.getTelemetry();
    expect(telemetry.cacheHits).toBeGreaterThan(0);
    expect(telemetry.cacheHitRatio).toBeGreaterThan(0);
  });

  it("bundles context fetches and reuses cached market data", async () => {
    await marketDataOrchestrator.fetchContextBundle({ symbol: "BTCTRY", lite: true, priority: "high" });
    const exchangeCallsAfterFirst = marketDataOrchestrator.getTelemetry().exchangeCalls;
    await marketDataOrchestrator.fetchContextBundle({ symbol: "BTCTRY", lite: true, priority: "high" });
    const telemetry = marketDataOrchestrator.getTelemetry();
    expect(exchangeCallsAfterFirst).toBeGreaterThan(0);
    expect(telemetry.cacheHits).toBeGreaterThan(0);
  });

  it("returns stale cache after 429 instead of flooding exchange", async () => {
    await marketDataOrchestrator.getTicker("BTCTRY", { priority: "normal" });
    providerMocks.getTicker.mockRejectedValue(new Error("HTTP 429 too much request weight used"));
    const stale = await marketDataOrchestrator.getTicker("BTCTRY", { priority: "normal", maxAgeMs: 0 });
    expect(stale.price).toBe(100);
    expect(providerMocks.getTicker).toHaveBeenCalledTimes(1);
  });
});
