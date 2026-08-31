import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/config";
import {
  getPumpScanLifecycleEvents,
  resetPumpScanLifecycleEvents,
  resolvePumpLiveScanTimeoutMs,
  runBoundedLivePumpScan,
} from "@/src/server/scanner/pump-scan-lifecycle.service";
import { resolveLiveTopGainerPumpCandidates } from "@/src/server/scanner/pump-early-catcher.service";

const mockBuildMarketContext = vi.fn(async (symbol: string) => ({
  symbol,
  lastPrice: 10,
  change24h: 12,
  volume24h: 2_000_000,
  volumeSpikePercent: 30,
  spreadPercent: 0.05,
  volatilityPercent: 1.2,
  momentumPercent: 0.3,
  orderBookImbalance: 0.2,
  buyPressure: 0.6,
  shortCandleSignal: 1,
  fakeSpikeScore: 0.8,
  pumpIntensity: 40,
  pumpRisk: 40,
  tradable: true,
  rejectReasons: [],
  metadata: {
    shortMomentumPercent: 0.2,
    shortFlowImbalance: 0.08,
    tradeVelocity: 0.2,
    hourMomentumPercent: 1.2,
    volumeSpikePercent: 25,
    liveDataHealthy: true,
  },
}));

const mockResolveWatchlist = vi.fn(async () =>
  Array.from({ length: 120 }).map((_, idx) => `S${idx}TRY`),
);

const mockDiscoverTopGainerSymbols = vi.fn(async (limit = 24) =>
  Array.from({ length: Math.max(limit, 36) }).map((_, idx) => ({
    symbol: `S${idx}TRY`,
    price: 10 + idx,
    change24h: 8 + idx * 0.1,
    volume24h: 1_500_000,
    priorityScore: 90 - idx,
    reason: `top-gainer-${idx}`,
    discoveredAt: "2026-08-17T00:00:00.000Z",
    source: "TOP_GAINER_24H" as const,
  })),
);

const mockGetTopGainerCacheMeta = vi.fn(() => ({
  hasCache: true,
  cacheAgeMs: 1_000,
  cacheTtlMs: 45_000,
  stale: false,
}));

vi.mock("@/src/server/scanner/market-context-builder", () => ({
  buildMarketContext: (...args: unknown[]) => mockBuildMarketContext(...args),
}));

vi.mock("@/src/server/scanner/watchlist.service", () => ({
  resolveWatchlist: (...args: unknown[]) => mockResolveWatchlist(...args),
}));

vi.mock("@/src/server/scanner/top-gainer-discovery.service", () => ({
  discoverTopGainerSymbols: (...args: unknown[]) => mockDiscoverTopGainerSymbols(...args),
  getTopGainerCacheMeta: (...args: unknown[]) => mockGetTopGainerCacheMeta(...args),
}));

vi.mock("@/src/server/exchange", () => ({
  getExchangeProvider: () => ({
    listTickers24h: vi.fn(async () => []),
  }),
}));

describe("P1 pump scan reliability + priority lane", () => {
  const originalIntraday = env.PUMP_INTRADAY_ENABLED;

  beforeEach(() => {
    resetPumpScanLifecycleEvents();
    mockBuildMarketContext.mockClear();
    mockResolveWatchlist.mockClear();
    mockDiscoverTopGainerSymbols.mockClear();
    mockGetTopGainerCacheMeta.mockClear();
    (env as unknown as { PUMP_INTRADAY_ENABLED: boolean }).PUMP_INTRADAY_ENABLED = false;
  });

  afterAll(() => {
    (env as unknown as { PUMP_INTRADAY_ENABLED: boolean }).PUMP_INTRADAY_ENABLED = originalIntraday;
  });

  it("respects effective deadline shorter than configured pump timeout", () => {
    const deadlineMs = Date.now() + 8_000;
    const timeoutMs = resolvePumpLiveScanTimeoutMs(deadlineMs);
    expect(timeoutMs).toBeLessThanOrEqual(7_000);
    expect(timeoutMs).toBeGreaterThanOrEqual(1_000);
  });

  it("propagates parent abort for bounded live scan", async () => {
    const controller = new AbortController();
    const task = (_signal: AbortSignal) =>
      new Promise<string>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("aborted by parent")), { once: true });
      });

    const run = runBoundedLivePumpScan("abort-repro", task, {
      abortSignal: controller.signal,
      scope: "live",
    });
    controller.abort("stop");
    await expect(run).rejects.toMatchObject({ code: "PUMP_SCAN_FAILED" });
    const events = getPumpScanLifecycleEvents(20);
    expect(events.some((row) => row.reasonCode === "PUMP_SCAN_ABORTED" || row.blockKind === "abort")).toBe(true);
  });

  it("uses cache on second call and avoids redundant live context scans", async () => {
    await resolveLiveTopGainerPumpCandidates({
      forceRefresh: true,
      limit: 12,
      maxSymbolsToEvaluate: 6,
    });
    const firstCalls = mockBuildMarketContext.mock.calls.length;
    await resolveLiveTopGainerPumpCandidates({
      forceRefresh: false,
      limit: 12,
      maxSymbolsToEvaluate: 6,
    });
    const secondCalls = mockBuildMarketContext.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    expect(secondCalls).toBe(firstCalls);
    const events = getPumpScanLifecycleEvents(40);
    expect(events.some((row) => row.kind === "cache_scan" && (row.meta as { cacheHit?: boolean })?.cacheHit === true)).toBe(true);
  });

  it("flags stale priority data in lifecycle telemetry", async () => {
    mockGetTopGainerCacheMeta.mockReturnValueOnce({
      hasCache: true,
      cacheAgeMs: 90_000,
      cacheTtlMs: 45_000,
      stale: true,
    });
    await resolveLiveTopGainerPumpCandidates({
      forceRefresh: true,
      limit: 8,
      maxSymbolsToEvaluate: 4,
    });
    const events = getPumpScanLifecycleEvents(40);
    expect(
      events.some(
        (row) =>
          row.kind === "priority_scan" &&
          row.message.includes("PRIORITY_DATA_STALE"),
      ),
    ).toBe(true);
  });

  it("keeps live pump symbol evaluation bounded", async () => {
    await resolveLiveTopGainerPumpCandidates({
      forceRefresh: true,
      limit: 12,
      maxSymbolsToEvaluate: 4,
    });
    expect(mockBuildMarketContext.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
