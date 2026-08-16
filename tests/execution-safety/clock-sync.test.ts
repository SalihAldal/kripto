import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  evaluateClockSync,
  evaluateStaleExchangeInfoClock,
  fetchFreshBinanceServerTime,
  normalizeServerTimeToMs,
  MAX_CLOCK_SKEW_MS,
} from "@/src/server/execution-safety/clock-sync.service";

describe("clock sync service", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ serverTime: Date.now() }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes seconds to milliseconds", () => {
    const normalized = normalizeServerTimeToMs(1_700_000_000);
    expect(normalized.unitConversionApplied).toBe(true);
    expect(normalized.ms).toBe(1_700_000_000_000);
  });

  it("passes when local clock matches server clock", async () => {
    const now = Date.now();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ serverTime: now }),
      })),
    );
    const result = await evaluateClockSync();
    expect(result.ok).toBe(true);
    expect(result.skewMs).toBeLessThanOrEqual(MAX_CLOCK_SKEW_MS);
  });

  it("allows +1s skew within threshold", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ serverTime: Date.now() + 1_000 }),
      })),
    );
    const result = await evaluateClockSync();
    expect(result.ok).toBe(true);
    expect(result.skewMs).toBeGreaterThanOrEqual(900);
  });

  it("blocks +30s skew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ serverTime: Date.now() + 30_000 }),
      })),
    );
    const result = await evaluateClockSync();
    expect(result.ok).toBe(false);
    expect(result.skewMs).toBeGreaterThan(MAX_CLOCK_SKEW_MS);
  });

  it("blocks +300s skew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ serverTime: Date.now() + 300_000 }),
      })),
    );
    const result = await evaluateClockSync();
    expect(result.ok).toBe(false);
    expect(result.forensics.rootCauseHint).toBe("FRESH_SERVER_TIME_SKEW");
  });

  it("detects stale exchangeInfo server time misuse", () => {
    const serverTimeMs = Date.now() - 254_663;
    const result = evaluateStaleExchangeInfoClock({
      serverTimeMs,
      cacheAgeMs: 254_663,
    });
    expect(result.staleServerTime).toBe(true);
    expect(result.rootCauseHint).toBe("STALE_EXCHANGE_INFO_SERVER_TIME");
    expect(result.skewMs).toBeLessThan(5_000);
  });

  it("retries with fresh server time after transient failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ serverTime: Date.now() }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const result = await evaluateClockSync({ maxAttempts: 2, retryDelayMs: 1 });
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("parses Binance TR timestamp field from error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ code: 3701, msg: "Invalid API-key", timestamp: Date.now() + 50 }),
      })),
    );
    const sample = await fetchFreshBinanceServerTime();
    expect(sample.serverTimeMs).toBeGreaterThan(Date.now() - 5_000);
  });

  it("blocks high API latency in validateApiHealth metadata path", async () => {
    vi.mock("@/services/binance.service", () => ({
      getTicker: vi.fn(async () => new Promise((resolve) => setTimeout(() => resolve({ price: 100 }), 3_000))),
    }));
    const { validateApiHealth } = await import("@/src/server/execution-safety/api-health-validation.service");
    const result = await validateApiHealth({
      executionId: "exec-latency",
      userId: "user-1",
      symbol: "BTCTRY",
      side: "BUY",
      mode: "paper",
      quantity: 1,
      priceHint: 100,
      quoteAsset: "TRY",
      baseAsset: "BTC",
      openPositionCount: 0,
      allowMultipleOpenPositions: false,
    });
    expect(result.passed).toBe(false);
    expect(result.reasons.some((row) => row.includes("API latency exceeds threshold"))).toBe(true);
  });
});
