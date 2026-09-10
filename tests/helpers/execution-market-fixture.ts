import type { ExecutionMarketSnapshot } from "@/src/server/execution/execution-market-snapshot.service";
import type { KlineItem } from "@/src/types/exchange";
export function executionKlines(count = 80, intervalMs = 60_000, now = Date.now()): KlineItem[] {
  const end = Math.floor(now / intervalMs) * intervalMs;
  return Array.from({ length: count }, (_, i) => {
    const price = 99 + i / 100;
    return { openTime: end - (count - i) * intervalMs, closeTime: end - (count - i - 1) * intervalMs - 1,
      open: price, high: price + .2, low: price - .2, close: price + .05, volume: 1000, closed: true };
  });
}
export function executionMarketFixture(symbol = "BTCTRY"): ExecutionMarketSnapshot {
  return { venue: "BINANCE_TR", symbol, fetchedAt: Date.now(),
    bundle: { symbol, ticker: { symbol, price: 100, change24h: 0, volume24h: 10_000_000, updatedAt: new Date().toISOString() },
      klines1m: executionKlines(), klines1h: [],
      orderBook: { lastUpdateId: 1, bids: [{ price: 99.99, quantity: 10000 }], asks: [{ price: 100.01, quantity: 10000 }] },
      recentTrades: [{ id: 1, price: 100, qty: 10, time: Date.now(), isBuyerMaker: false }] },
    timeframes: { "5m": executionKlines(80, 300000), "15m": executionKlines(80, 900000),
      "1h": executionKlines(80, 3600000), "4h": executionKlines(80, 14400000), "1d": executionKlines(80, 86400000) } };
}
