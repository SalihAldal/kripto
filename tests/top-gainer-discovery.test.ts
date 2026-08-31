import { beforeEach, describe, expect, it, vi } from "vitest";

const mockListTickers24h = vi.fn();

vi.mock("@/src/server/exchange", () => ({
  getExchangeProvider: () => ({
    listTickers24h: mockListTickers24h,
  }),
}));

vi.mock("@/lib/config", () => ({
  env: {
    PUMP_DISCOVERY_MIN_CHANGE_24H: 1,
    SCANNER_MIN_VOLUME_24H: 100_000,
    BINANCE_PLATFORM: "tr",
  },
}));

describe("top gainer discovery resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("retries transient ticker failures and succeeds", async () => {
    mockListTickers24h
      .mockRejectedValueOnce(new Error("HTTP 429 too many requests"))
      .mockResolvedValueOnce([
        { symbol: "BTCTRY", price: 1, change24h: 3.1, volume24h: 900_000 },
      ]);
    const events: Array<{ reasonCode: string; retryCount: number; dataStatus: string }> = [];
    const { discoverTopGainerSymbols } = await import("@/src/server/scanner/top-gainer-discovery.service");
    const rows = await discoverTopGainerSymbols(12, {
      onMarketDataEvent: (event) => {
        events.push({
          reasonCode: event.reasonCode,
          retryCount: event.retryCount,
          dataStatus: event.dataStatus,
        });
      },
    });
    expect(rows.length).toBe(1);
    expect(mockListTickers24h).toHaveBeenCalledTimes(2);
    expect(events.some((row) => row.dataStatus === "LIVE")).toBe(true);
    expect(events.some((row) => row.reasonCode === "MARKET_DATA_RATE_LIMIT")).toBe(true);
  });

  it("uses cache fallback when endpoint stays unavailable", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    const { discoverTopGainerSymbols } = await import("@/src/server/scanner/top-gainer-discovery.service");
    mockListTickers24h.mockResolvedValueOnce([
      { symbol: "ETHTRY", price: 1, change24h: 2.2, volume24h: 800_000 },
    ]);
    const seeded = await discoverTopGainerSymbols(12);
    expect(seeded.length).toBe(1);

    nowSpy.mockReturnValue(1_000_000 + 60_000);
    mockListTickers24h.mockRejectedValue(new Error("fetch failed"));
    const events: Array<{ dataStatus: string; fallbackUsed: boolean }> = [];
    const rows = await discoverTopGainerSymbols(12, {
      onMarketDataEvent: (event) => {
        events.push({ dataStatus: event.dataStatus, fallbackUsed: event.fallbackUsed });
      },
    });
    expect(rows.length).toBe(1);
    expect(events.some((row) => row.dataStatus === "CACHE_FALLBACK" && row.fallbackUsed)).toBe(true);
    nowSpy.mockRestore();
  });

  it("rejects stale cache fallback and returns unavailable", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_000_000);
    const { discoverTopGainerSymbols } = await import("@/src/server/scanner/top-gainer-discovery.service");
    mockListTickers24h.mockResolvedValueOnce([
      { symbol: "SOLTRY", price: 1, change24h: 5, volume24h: 900_000 },
    ]);
    await discoverTopGainerSymbols(12);
    nowSpy.mockReturnValue(1_000_000 + 10 * 60_000);
    mockListTickers24h.mockRejectedValue(new Error("network error"));
    const rows = await discoverTopGainerSymbols(12);
    expect(rows).toEqual([]);
    nowSpy.mockRestore();
  });
});
