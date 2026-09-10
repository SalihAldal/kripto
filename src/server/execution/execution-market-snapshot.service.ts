import { env } from "@/lib/config";
import { marketDataGateway } from "@/src/server/market-data/market-data-gateway";
import { assessKlineInput } from "@/src/server/market-data/kline-input-contract.service";
import type { MarketContextBundle } from "@/src/server/market-data/market-data.types";
import type { KlineItem } from "@/src/types/exchange";

export const EXECUTION_TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;
export type ExecutionMarketSnapshot = {
  venue: "BINANCE_TR" | "BINANCE_GLOBAL";
  symbol: string;
  fetchedAt: number;
  bundle: MarketContextBundle;
  timeframes: Record<typeof EXECUTION_TIMEFRAMES[number], KlineItem[]>;
};

export function closedExecutionKlines(rows: KlineItem[], now = Date.now()) {
  return rows.filter(row => row.closed !== false && row.closeTime <= now && row.openTime > 0 &&
    row.closeTime > row.openTime && [row.open, row.high, row.low, row.close].every(x => Number.isFinite(x) && x > 0))
    .sort((a, b) => a.openTime - b.openTime);
}

export function executionSnapshotIssues(snapshot: ExecutionMarketSnapshot, now = Date.now()): string[] {
  const { bundle, symbol } = snapshot;
  const issues: string[] = [];
  if (bundle.symbol !== symbol || bundle.ticker.symbol !== symbol) issues.push("EXECUTION_SYMBOL_MISMATCH");
  if (!Number.isFinite(bundle.ticker.price) || bundle.ticker.price <= 0) issues.push("EXECUTION_PRICE_INVALID");
  if (!Number.isFinite(bundle.ticker.volume24h) || bundle.ticker.volume24h < 0 || !Number.isFinite(bundle.ticker.change24h)) issues.push("EXECUTION_24H_STATS_INVALID");
  const tickerAt = Date.parse(bundle.ticker.updatedAt);
  if (!Number.isFinite(tickerAt) || now - tickerAt > 15_000 || tickerAt > now + 1000) issues.push("EXECUTION_TICKER_STALE");
  const book = bundle.orderBook;
  const bid = book?.bids[0], ask = book?.asks[0];
  if (!bid || !ask || ![bid.price, bid.quantity, ask.price, ask.quantity].every(x => Number.isFinite(x) && x > 0) || bid.price >= ask.price) {
    issues.push("EXECUTION_BOOK_INVALID");
  }
  const assessment = assessKlineInput({ klines: bundle.klines1m, nowMs: now });
  if (!assessment.fresh) issues.push(assessment.reasonCode ?? "EXECUTION_KLINES_UNAVAILABLE");
  if (now - snapshot.fetchedAt > 15_000) issues.push("EXECUTION_SNAPSHOT_STALE");
  return issues;
}

/** Explicit, rate-limited recovery for one selected market. Never read global WS as TR execution data. */
export async function loadExecutionMarketSnapshot(symbol: string, signal?: AbortSignal): Promise<ExecutionMarketSnapshot> {
  const options = { recovery: true, strictExecution: true, allowStaleOnBackoff: false, priority: "high" as const, maxAgeMs: 1000, timeoutMs: 12_000, signal };
  const [bundle, ...timeframes] = await Promise.all([
    marketDataGateway.fetchContextBundle({ symbol, lite: false, ...options }),
    ...EXECUTION_TIMEFRAMES.map(interval => marketDataGateway.getKlines(symbol, interval, 80, options)),
  ]);
  signal?.throwIfAborted();
  const now = Date.now();
  return {
    venue: env.BINANCE_PLATFORM === "tr" ? "BINANCE_TR" : "BINANCE_GLOBAL", symbol, fetchedAt: now,
    bundle: { ...bundle, klines1m: closedExecutionKlines(bundle.klines1m, now) },
    timeframes: Object.fromEntries(EXECUTION_TIMEFRAMES.map((tf, i) => [tf, closedExecutionKlines(timeframes[i], now)])) as ExecutionMarketSnapshot["timeframes"],
  };
}
