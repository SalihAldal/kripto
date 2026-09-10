import { expect, it, vi } from "vitest";
import { executionKlines, executionMarketFixture } from "./helpers/execution-market-fixture";
import { closedExecutionKlines, executionSnapshotIssues, loadExecutionMarketSnapshot } from "@/src/server/execution/execution-market-snapshot.service";
const m = vi.hoisted(() => ({ bundle: vi.fn(), klines: vi.fn() }));
vi.mock("@/src/server/market-data/market-data-gateway", () => ({ marketDataGateway: { fetchContextBundle: m.bundle, getKlines: m.klines } }));
it("requires closed candles, valid uncrossed book and fresh exact-symbol ticker", () => {
  const snap = executionMarketFixture(); expect(executionSnapshotIssues(snap)).toEqual([]);
  snap.bundle.ticker.symbol = "BTCUSDT";
  snap.bundle.orderBook!.asks[0].price = 90;
  snap.bundle.klines1m = executionKlines(10);
  expect(executionSnapshotIssues(snap)).toEqual(expect.arrayContaining(["EXECUTION_SYMBOL_MISMATCH", "EXECUTION_BOOK_INVALID", "KLINE_COUNT_INSUFFICIENT"]));
});
it("removes open, future and malformed candles without inventing history", () => {
  const rows = executionKlines(25);
  expect(closedExecutionKlines([...rows, { ...rows[0], closed: false }, { ...rows[0], closeTime: Date.now() + 60000 }, { ...rows[0], close: NaN }])).toEqual(rows);
});
it("requests bounded strict venue REST for all five timeframes and base bundle", async () => {
  m.bundle.mockResolvedValue(executionMarketFixture().bundle); m.klines.mockResolvedValue(executionKlines());
  const result = await loadExecutionMarketSnapshot("BTCTRY");
  expect(executionSnapshotIssues(result)).toEqual([]);
  expect(m.bundle).toHaveBeenCalledWith(expect.objectContaining({ strictExecution: true, recovery: true, allowStaleOnBackoff: false }));
  for (const tf of ["5m", "15m", "1h", "4h", "1d"]) expect(m.klines).toHaveBeenCalledWith("BTCTRY", tf, 80, expect.objectContaining({ strictExecution: true }));
});
