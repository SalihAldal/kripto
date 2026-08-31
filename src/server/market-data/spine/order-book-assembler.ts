import type { OrderBookSnapshot } from "@/src/types/exchange";
import type { MarketDepthDeltaEvent } from "@/src/server/market-data/spine/events";

const BOOK_LIMIT = 50;

type LevelMap = Map<string, number>;

export type OrderBookAssemblerStatus = "EMPTY" | "BUFFERING" | "SYNCING" | "LIVE" | "GAP" | "INVALID";

export class OrderBookAssembler {
  private bids: LevelMap = new Map();
  private asks: LevelMap = new Map();
  private lastUpdateId = 0;
  private buffer: MarketDepthDeltaEvent[] = [];
  private snapshotPending = false;
  status: OrderBookAssemblerStatus = "EMPTY";
  gapDetected = false;

  reset() {
    this.bids.clear();
    this.asks.clear();
    this.lastUpdateId = 0;
    this.buffer = [];
    this.snapshotPending = false;
    this.status = "EMPTY";
    this.gapDetected = false;
  }

  applyDelta(event: MarketDepthDeltaEvent): "ok" | "buffer" | "gap" {
    if (this.status === "LIVE") {
      if (event.firstUpdateId > this.lastUpdateId + 1) {
        this.markGap();
        return "gap";
      }
      if (event.finalUpdateId <= this.lastUpdateId) return "ok";
      this.applyLevels(event);
      this.lastUpdateId = event.finalUpdateId;
      return "ok";
    }

    this.buffer.push(event);
    if (this.buffer.length > 500) this.buffer.splice(0, this.buffer.length - 200);
    this.status = this.snapshotPending ? "SYNCING" : "BUFFERING";
    return "buffer";
  }

  beginSnapshot() {
    this.snapshotPending = true;
    this.status = "SYNCING";
  }

  applySnapshot(snapshot: { lastUpdateId: number; bids: Array<[number, number]>; asks: Array<[number, number]> }) {
    this.bids.clear();
    this.asks.clear();
    for (const [price, qty] of snapshot.bids) this.writeLevel(this.bids, price, qty);
    for (const [price, qty] of snapshot.asks) this.writeLevel(this.asks, price, qty);
    this.lastUpdateId = snapshot.lastUpdateId;
    this.snapshotPending = false;
    this.gapDetected = false;

    const remaining: MarketDepthDeltaEvent[] = [];
    let synced = false;
    for (const event of this.buffer) {
      if (event.finalUpdateId <= snapshot.lastUpdateId) continue;
      if (!synced) {
        if (event.firstUpdateId > snapshot.lastUpdateId + 1) {
          this.markGap();
          return false;
        }
        if (event.firstUpdateId <= snapshot.lastUpdateId + 1 && event.finalUpdateId >= snapshot.lastUpdateId + 1) {
          this.applyLevels(event);
          this.lastUpdateId = event.finalUpdateId;
          synced = true;
          continue;
        }
        continue;
      }
      if (event.firstUpdateId > this.lastUpdateId + 1) {
        remaining.push(event);
        this.markGap();
        return false;
      }
      if (event.finalUpdateId <= this.lastUpdateId) continue;
      this.applyLevels(event);
      this.lastUpdateId = event.finalUpdateId;
    }
    this.buffer = remaining;
    this.status = "LIVE";
    return true;
  }

  snapshot(): OrderBookSnapshot {
    const bids = this.sorted(this.bids, "desc");
    const asks = this.sorted(this.asks, "asc");
    return {
      lastUpdateId: this.lastUpdateId,
      bids,
      asks,
    };
  }

  needsResync() {
    return this.status === "GAP" || this.status === "INVALID";
  }

  private markGap() {
    this.status = "GAP";
    this.gapDetected = true;
    this.buffer = [];
  }

  private applyLevels(event: MarketDepthDeltaEvent) {
    for (const [price, qty] of event.bids) this.writeLevel(this.bids, price, qty);
    for (const [price, qty] of event.asks) this.writeLevel(this.asks, price, qty);
  }

  private writeLevel(map: LevelMap, price: number, qty: number) {
    const key = price.toFixed(8);
    if (qty <= 0) map.delete(key);
    else map.set(key, qty);
  }

  private sorted(map: LevelMap, dir: "asc" | "desc") {
    const rows = [...map.entries()].map(([price, quantity]) => ({ price: Number(price), quantity }));
    rows.sort((a, b) => (dir === "asc" ? a.price - b.price : b.price - a.price));
    return rows.slice(0, BOOK_LIMIT);
  }
}
