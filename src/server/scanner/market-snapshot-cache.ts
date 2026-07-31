import type { KlineItem, OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";

type Snapshot = {
  symbol: string;
  klines: KlineItem[];
  orderBook: OrderBookSnapshot;
  recentTrades: RecentTrade[];
  at: number;
};

const SNAPSHOT_TTL_MS = 25_000;
const snapshotCache = new Map<string, Snapshot>();

export function putMarketSnapshot(symbol: string, snapshot: Omit<Snapshot, "symbol" | "at">) {
  const normalized = symbol.toUpperCase();
  snapshotCache.set(normalized, {
    symbol: normalized,
    klines: snapshot.klines,
    orderBook: snapshot.orderBook,
    recentTrades: snapshot.recentTrades,
    at: Date.now(),
  });
}

export function getMarketSnapshot(symbol: string) {
  const normalized = symbol.toUpperCase();
  const row = snapshotCache.get(normalized);
  if (!row) return null;
  if (Date.now() - row.at > SNAPSHOT_TTL_MS) {
    snapshotCache.delete(normalized);
    return null;
  }
  return row;
}
