import { BoundedRingBuffer } from "@/src/server/market-data/spine/ring-buffer";
import { computeRollingMetrics } from "@/src/server/market-data/spine/rolling-metrics";
import type {
  BookTickerState,
  DeepMarketState,
  MarketBookTickerEvent,
  MarketCandleEvent,
  MarketTickerEvent,
  MarketTradeEvent,
  RollingMetrics,
  SymbolMarketSnapshot,
} from "@/src/server/market-data/spine/events";
import type { KlineItem, OrderBookSnapshot, RecentTrade } from "@/src/types/exchange";

const RING_CAPACITY = 1024;
const TRADE_BUFFER_LIMIT = 2048;
const KLINE_BUFFER_LIMIT = 180;
const DEFAULT_STALE_MS = 5_000;

export type SymbolSlot = {
  symbol: string;
  lastPrice: number;
  previousPrice: number;
  openPrice: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  baseVolume24h: number;
  eventTime: number;
  localReceiveTime: number;
  lastUpdateAt: number;
  sequence: number;
  ring: BoundedRingBuffer;
  bookTicker: BookTickerState | null;
  trades: MarketTradeEvent[];
  klines1m: KlineItem[];
  orderBook: OrderBookSnapshot | null;
  orderBookValid: boolean;
  orderBookGap: boolean;
};

export class MarketStateStore {
  private readonly slots = new Map<string, SymbolSlot>();
  private snapshotCache: SymbolMarketSnapshot[] | null = null;
  private snapshotCacheAt = 0;
  readonly staleMs: number;

  constructor(staleMs = DEFAULT_STALE_MS) {
    this.staleMs = staleMs;
  }

  get size() {
    return this.slots.size;
  }

  applyTicker(event: MarketTickerEvent, now = Date.now()) {
    const slot = this.ensure(event.symbol);
    slot.previousPrice = slot.lastPrice > 0 ? slot.lastPrice : event.price;
    slot.lastPrice = event.price;
    slot.openPrice = event.openPrice;
    slot.high24h = event.high24h;
    slot.low24h = event.low24h;
    slot.quoteVolume24h = event.quoteVolume;
    slot.baseVolume24h = event.baseVolume;
    slot.eventTime = event.eventTime;
    slot.localReceiveTime = event.receiveTime;
    slot.lastUpdateAt = now;
    slot.sequence += 1;
    slot.ring.push({
      t: event.eventTime || now,
      price: event.price,
      quoteVolume: event.quoteVolume,
      baseVolume: event.baseVolume,
    });
    this.snapshotCache = null;
  }

  applyBookTicker(event: MarketBookTickerEvent, now = Date.now()) {
    const slot = this.ensure(event.symbol);
    slot.bookTicker = {
      symbol: event.symbol,
      bestBid: event.bestBid,
      bestBidQty: event.bestBidQty,
      bestAsk: event.bestAsk,
      bestAskQty: event.bestAskQty,
      spreadAbsolute: event.spreadAbsolute,
      spreadBps: event.spreadBps,
      eventTime: event.eventTime,
      lastUpdateAt: now,
      stale: false,
    };
  }

  applyTrade(event: MarketTradeEvent) {
    const slot = this.ensure(event.symbol);
    slot.trades.push(event);
    if (slot.trades.length > TRADE_BUFFER_LIMIT) {
      slot.trades.splice(0, slot.trades.length - TRADE_BUFFER_LIMIT);
    }
  }

  applyCandle(event: MarketCandleEvent) {
    if (event.interval !== "1m") return;
    const slot = this.ensure(event.symbol);
    const next: KlineItem = {
      openTime: event.openTime,
      closeTime: event.closeTime,
      open: event.open,
      high: event.high,
      low: event.low,
      close: event.close,
      volume: event.volume,
    };
    const last = slot.klines1m[slot.klines1m.length - 1];
    if (last && last.openTime === next.openTime) {
      slot.klines1m[slot.klines1m.length - 1] = next;
    } else {
      slot.klines1m.push(next);
      if (slot.klines1m.length > KLINE_BUFFER_LIMIT) {
        slot.klines1m.splice(0, slot.klines1m.length - KLINE_BUFFER_LIMIT);
      }
    }
  }

  seedKlines(symbol: string, rows: KlineItem[]) {
    const slot = this.ensure(symbol);
    slot.klines1m = rows.slice(-KLINE_BUFFER_LIMIT).map((row) => ({ ...row }));
  }

  setOrderBook(symbol: string, book: OrderBookSnapshot | null, valid: boolean, gap: boolean) {
    const slot = this.ensure(symbol);
    slot.orderBook = book;
    slot.orderBookValid = valid;
    slot.orderBookGap = gap;
  }

  getLatest(symbol: string, now = Date.now()): SymbolMarketSnapshot | null {
    const slot = this.slots.get(symbol.toUpperCase());
    if (!slot || slot.lastPrice <= 0) return null;
    return this.toSnapshot(slot, now);
  }

  getWindow(symbol: string, durationMs: number) {
    const slot = this.slots.get(symbol.toUpperCase());
    if (!slot) return [];
    const cutoff = Date.now() - durationMs;
    return slot.ring.snapshot().filter((row) => row.t >= cutoff);
  }

  getRolling(symbol: string, now = Date.now()): RollingMetrics | null {
    const slot = this.slots.get(symbol.toUpperCase());
    if (!slot) return null;
    return computeRollingMetrics(slot.ring, now);
  }

  getDeepState(symbol: string, now = Date.now()): DeepMarketState | null {
    const slot = this.slots.get(symbol.toUpperCase());
    if (!slot) return null;
    const book = slot.bookTicker
      ? { ...slot.bookTicker, stale: now - slot.bookTicker.lastUpdateAt > this.staleMs }
      : null;
    return {
      symbol: slot.symbol,
      bookTicker: book,
      recentTrades: slot.trades.slice(-TRADE_BUFFER_LIMIT),
      klines1m: slot.klines1m.slice(-KLINE_BUFFER_LIMIT),
      orderBookValid: slot.orderBookValid,
      orderBookGap: slot.orderBookGap,
    };
  }

  getOrderBook(symbol: string): OrderBookSnapshot | null {
    return this.slots.get(symbol.toUpperCase())?.orderBook ?? null;
  }

  getRecentTrades(symbol: string, limit = 50): RecentTrade[] {
    const slot = this.slots.get(symbol.toUpperCase());
    if (!slot) return [];
    return slot.trades.slice(-limit).map((trade, index) => ({
      id: trade.aggregateId ?? index,
      price: trade.price,
      qty: trade.quantity,
      quoteQty: trade.quoteNotional,
      time: trade.tradeTime,
      isBuyerMaker: trade.buyerMaker,
    }));
  }

  getKlines(symbol: string, limit = 100): KlineItem[] {
    const slot = this.slots.get(symbol.toUpperCase());
    if (!slot) return [];
    return slot.klines1m.slice(-limit).map((row) => ({ ...row }));
  }

  isFresh(symbol: string, now = Date.now()) {
    const slot = this.slots.get(symbol.toUpperCase());
    if (!slot || slot.lastPrice <= 0) return false;
    return now - slot.lastUpdateAt <= this.staleMs;
  }

  getMarketSnapshot(now = Date.now()): SymbolMarketSnapshot[] {
    if (this.snapshotCache && now - this.snapshotCacheAt < 50) {
      return this.snapshotCache;
    }
    const rows: SymbolMarketSnapshot[] = [];
    for (const slot of this.slots.values()) {
      if (slot.lastPrice <= 0) continue;
      rows.push(this.toSnapshot(slot, now));
    }
    this.snapshotCache = rows;
    this.snapshotCacheAt = now;
    return rows;
  }

  staleSymbols(now = Date.now()) {
    const stale: string[] = [];
    for (const slot of this.slots.values()) {
      if (slot.lastPrice > 0 && now - slot.lastUpdateAt > this.staleMs) stale.push(slot.symbol);
    }
    return stale;
  }

  liveSymbolCount(now = Date.now()) {
    let count = 0;
    for (const slot of this.slots.values()) {
      if (slot.lastPrice > 0 && now - slot.lastUpdateAt <= this.staleMs) count += 1;
    }
    return count;
  }

  estimatedMemoryBytes() {
    let bytes = 0;
    for (const slot of this.slots.values()) {
      bytes += slot.ring.estimatedBytes();
      bytes += slot.trades.length * 120;
      bytes += slot.klines1m.length * 80;
    }
    return bytes;
  }

  maxRingSize() {
    let max = 0;
    for (const slot of this.slots.values()) {
      if (slot.ring.size > max) max = slot.ring.size;
    }
    return max;
  }

  clear() {
    this.slots.clear();
    this.snapshotCache = null;
  }

  private ensure(symbol: string): SymbolSlot {
    const key = symbol.toUpperCase();
    const existing = this.slots.get(key);
    if (existing) return existing;
    const created: SymbolSlot = {
      symbol: key,
      lastPrice: 0,
      previousPrice: 0,
      openPrice: 0,
      high24h: 0,
      low24h: 0,
      quoteVolume24h: 0,
      baseVolume24h: 0,
      eventTime: 0,
      localReceiveTime: 0,
      lastUpdateAt: 0,
      sequence: 0,
      ring: new BoundedRingBuffer(RING_CAPACITY),
      bookTicker: null,
      trades: [],
      klines1m: [],
      orderBook: null,
      orderBookValid: false,
      orderBookGap: false,
    };
    this.slots.set(key, created);
    return created;
  }

  private toSnapshot(slot: SymbolSlot, now: number): SymbolMarketSnapshot {
    const change24h =
      slot.openPrice > 0 ? Number((((slot.lastPrice - slot.openPrice) / slot.openPrice) * 100).toFixed(4)) : 0;
    return {
      symbol: slot.symbol,
      lastPrice: slot.lastPrice,
      previousPrice: slot.previousPrice,
      openPrice: slot.openPrice,
      change24h,
      high24h: slot.high24h,
      low24h: slot.low24h,
      quoteVolume24h: slot.quoteVolume24h,
      baseVolume24h: slot.baseVolume24h,
      eventTime: slot.eventTime,
      localReceiveTime: slot.localReceiveTime,
      lastUpdateAt: slot.lastUpdateAt,
      stale: now - slot.lastUpdateAt > this.staleMs,
      rolling: computeRollingMetrics(slot.ring, now),
    };
  }
}
