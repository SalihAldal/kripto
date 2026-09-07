import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  assessKlineInput,
  AI_KLINE_MAX_AGE_SEC,
  AI_KLINE_MIN_COUNT,
  buildKlineStaleMessage,
} from "@/src/server/market-data/kline-input-contract.service";
import {
  ensureFreshKlineContext,
  resetEnsureFreshKlineInflightForTests,
} from "@/src/server/market-data/ensure-fresh-kline-context.service";
import type { KlineItem } from "@/src/types/exchange";

function buildKlines(count: number, closeOffsetMs = 30_000): KlineItem[] {
  const now = Date.now();
  return Array.from({ length: count }).map((_, i) => ({
    open: 1,
    high: 1.01,
    low: 0.99,
    close: 1,
    volume: 100,
    openTime: now - (count - i) * 60_000,
    closeTime: now - (count - i - 1) * 60_000 - closeOffsetMs,
  }));
}

vi.mock("@/src/server/market-data/market-data-gateway", () => ({
  marketDataGateway: {
    getKlines: vi.fn(),
  },
}));

vi.mock("@/src/server/market-data/spine/market-data-daemon", () => ({
  getMarketDataDaemon: vi.fn(() => ({
    subscribeDeep: vi.fn(),
  })),
}));

vi.mock("@/src/server/scanner/market-snapshot-cache", () => ({
  getMarketSnapshot: vi.fn(() => null),
  putMarketSnapshot: vi.fn(),
}));

describe("kline input contract", () => {
  beforeEach(() => {
    resetEnsureFreshKlineInflightForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEnsureFreshKlineInflightForTests();
  });

  it("CASE 1: 25 fresh 1m klines PASS", () => {
    const now = Date.now();
    const assessment = assessKlineInput({ klines: buildKlines(25), nowMs: now });
    expect(assessment.fresh).toBe(true);
    expect(assessment.reasonCode).toBeNull();
    expect(assessment.count).toBeGreaterThanOrEqual(AI_KLINE_MIN_COUNT);
    expect(assessment.ageSec).not.toBeNull();
    expect(assessment.ageSec!).toBeLessThanOrEqual(AI_KLINE_MAX_AGE_SEC);
  });

  it("CASE 2: 19 klines => KLINE_COUNT_INSUFFICIENT", () => {
    const assessment = assessKlineInput({ klines: buildKlines(19), nowMs: Date.now() });
    expect(assessment.fresh).toBe(false);
    expect(assessment.reasonCode).toBe("KLINE_COUNT_INSUFFICIENT");
    expect(buildKlineStaleMessage(assessment)).toContain("KLINE_COUNT_INSUFFICIENT");
  });

  it("CASE 5: seconds timestamp normalized and assessed", () => {
    const now = Date.now();
    const secKlines = buildKlines(25).map((row) => ({
      ...row,
      openTime: Math.floor(row.openTime / 1000),
      closeTime: Math.floor((now - 30_000) / 1000),
    }));
    const assessment = assessKlineInput({ klines: secKlines, nowMs: now });
    expect(assessment.fresh).toBe(true);
    expect(assessment.lastCloseTime).toBeGreaterThan(1e12);
  });

  it("CASE 3/4: stale klines trigger refresh path", async () => {
    const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
    const stale = buildKlines(25, 240_000);
    const fresh = buildKlines(25, 30_000);

    vi.mocked(marketDataGateway.getKlines)
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce(fresh);

    const result = await ensureFreshKlineContext({
      symbol: "ONDOUSDT",
      existingKlines: stale,
    });
    expect(result.refreshAttempted).toBe(true);
    expect(result.refreshSucceeded).toBe(true);
    expect(result.fresh).toBe(true);
    expect(result.source).toBe("rest_recovery");
    expect(marketDataGateway.getKlines).toHaveBeenLastCalledWith("ONDOUSDT", "1m", 80, {
      recovery: true,
      priority: "high",
    });
  });

  it("CASE 4: refresh fails => stale remains", async () => {
    const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
    const stale = buildKlines(25, 240_000);
    vi.mocked(marketDataGateway.getKlines)
      .mockRejectedValueOnce(new Error("not ready"))
      .mockRejectedValueOnce(new Error("rest down"));

    const result = await ensureFreshKlineContext({
      symbol: "EPICUSDT",
      existingKlines: stale,
    });
    expect(result.refreshAttempted).toBe(true);
    expect(result.refreshSucceeded).toBe(false);
    expect(result.fresh).toBe(false);
    expect(result.reasonCode).toBe("KLINE_TOO_OLD");
  });

  it("CASE 6: ARBTRY refresh uses recovery", async () => {
    const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
    vi.mocked(marketDataGateway.getKlines)
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce(buildKlines(25));

    const result = await ensureFreshKlineContext({ symbol: "ARBTRY" });
    expect(result.symbol).toBe("ARBTRY");
    expect(result.fresh).toBe(true);
    expect(marketDataGateway.getKlines).toHaveBeenCalledWith("ARBTRY", "1m", 80, {
      recovery: true,
      priority: "high",
    });
  });

  it("CASE 8: fresh cache avoids REST recovery", async () => {
    const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
    const { getMarketSnapshot } = await import("@/src/server/scanner/market-snapshot-cache");
    vi.mocked(getMarketSnapshot).mockReturnValue({
      klines: buildKlines(25),
      orderBook: { lastUpdateId: 0, bids: [], asks: [] },
      recentTrades: [],
      updatedAt: Date.now(),
    });
    vi.mocked(marketDataGateway.getKlines).mockClear();

    const result = await ensureFreshKlineContext({ symbol: "ONDOUSDT" });
    expect(result.fresh).toBe(true);
    expect(result.refreshAttempted).toBe(false);
    expect(marketDataGateway.getKlines).not.toHaveBeenCalled();
  });

  it("CASE 9: stale cache triggers REST refresh", async () => {
    const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
    const { getMarketSnapshot } = await import("@/src/server/scanner/market-snapshot-cache");
    vi.mocked(getMarketSnapshot).mockReturnValue({
      klines: buildKlines(25, 240_000),
      orderBook: { lastUpdateId: 0, bids: [], asks: [] },
      recentTrades: [],
      updatedAt: Date.now(),
    });
    vi.mocked(marketDataGateway.getKlines)
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValueOnce(buildKlines(25));

    const result = await ensureFreshKlineContext({ symbol: "CFGTRY" });
    expect(result.refreshAttempted).toBe(true);
    expect(result.refreshSucceeded).toBe(true);
    expect(result.fresh).toBe(true);
  });

  it("CASE 10: concurrent same-symbol hydration coalesces", async () => {
    const { marketDataGateway } = await import("@/src/server/market-data/market-data-gateway");
    vi.mocked(marketDataGateway.getKlines).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(buildKlines(25)), 40);
        }),
    );

    const [a, b] = await Promise.all([
      ensureFreshKlineContext({ symbol: "OPENUSDT" }),
      ensureFreshKlineContext({ symbol: "OPENUSDT" }),
    ]);
    expect(a.count).toBe(b.count);
    expect(marketDataGateway.getKlines).toHaveBeenCalledTimes(1);
  });
});
