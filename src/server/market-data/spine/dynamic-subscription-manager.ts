export type DeepStreamKind = "aggTrade" | "bookTicker" | "kline_1m" | "depth";

export type SubscriptionOwner = string;
export type SubscriptionLifecycleState = "REQUESTED" | "ACTIVE" | "UNSUBSCRIBE_PENDING" | "INACTIVE";

const STREAM_SUFFIX: Record<DeepStreamKind, string> = {
  aggTrade: "@aggTrade",
  bookTicker: "@bookTicker",
  kline_1m: "@kline_1m",
  depth: "@depth@100ms",
};

export const BINANCE_MAX_STREAMS_PER_CONNECTION = 1024;
export const BINANCE_MAX_INCOMING_MESSAGES_PER_SEC = 5;

export function toBinanceStreamName(symbol: string, kind: DeepStreamKind) {
  return `${symbol.toLowerCase()}${STREAM_SUFFIX[kind]}`;
}

type RefEntry = {
  count: number;
  owners: Map<SubscriptionOwner, number>;
  state: SubscriptionLifecycleState;
  holdUntil: number;
};

export class DynamicSubscriptionManager {
  readonly instanceId = `dynamic-sub-manager:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  private readonly refs = new Map<string, RefEntry>();
  private readonly desired = new Set<string>();
  private readonly leases = new Map<string, { symbol: string; kind: DeepStreamKind; owner: string; expires: number }>();
  private duplicateSuppressed = 0;
  private leaseCapacityRejected = 0;
  private readonly minHoldMs = 1_200;

  /** Scanner polling renews one owner reference; it must not acquire one per read. */
  ensureLease(symbol: string, kinds: DeepStreamKind[], owner: string, ttlMs = 120000) {
    if (!Number.isFinite(ttlMs) || ttlMs <= this.minHoldMs) throw new Error("INVALID_SUBSCRIPTION_LEASE_TTL");
    const additional = [...new Set(kinds)].filter(kind => !this.desired.has(toBinanceStreamName(symbol, kind))).length;
    if (this.desired.size + additional > BINANCE_MAX_STREAMS_PER_CONNECTION) { this.leaseCapacityRejected++; return []; }
    const added: string[] = [];
    for (const kind of new Set(kinds)) {
      const key = `${owner}:${toBinanceStreamName(symbol, kind)}`;
      if (!this.leases.has(key)) added.push(...this.subscribe(symbol, [kind], owner));
      this.leases.set(key, { symbol, kind, owner, expires: Date.now() + ttlMs });
    }
    return added;
  }

  expireLeases(now = Date.now()) {
    const removed: string[] = [];
    for (const [key, lease] of this.leases) if (lease.expires <= now) {
      this.leases.delete(key);
      removed.push(...this.unsubscribe(lease.symbol, [lease.kind], lease.owner));
    }
    return removed;
  }

  subscribe(symbol: string, kinds: DeepStreamKind[], owner: SubscriptionOwner): string[] {
    const added: string[] = [];
    const now = Date.now();
    for (const kind of kinds) {
      const stream = toBinanceStreamName(symbol, kind);
      const entry = this.refs.get(stream) ?? { count: 0, owners: new Map(), state: "INACTIVE", holdUntil: 0 };
      const ownerCount = entry.owners.get(owner) ?? 0;
      entry.owners.set(owner, ownerCount + 1);
      entry.count += 1;
      entry.holdUntil = now + this.minHoldMs;
      this.refs.set(stream, entry);
      if (entry.count === 1 && entry.state === "INACTIVE") {
        entry.state = "REQUESTED";
        this.desired.add(stream);
        added.push(stream);
      } else {
        this.duplicateSuppressed += 1;
      }
    }
    return added;
  }

  unsubscribe(symbol: string, kinds: DeepStreamKind[], owner: SubscriptionOwner): string[] {
    const removed: string[] = [];
    const now = Date.now();
    for (const kind of kinds) {
      const stream = toBinanceStreamName(symbol, kind);
      const entry = this.refs.get(stream);
      if (!entry) continue;
      const ownerCount = entry.owners.get(owner) ?? 0;
      if (ownerCount <= 0) continue;
      this.leases.delete(`${owner}:${stream}`);
      if (ownerCount === 1) entry.owners.delete(owner);
      else entry.owners.set(owner, ownerCount - 1);
      entry.count = Math.max(0, entry.count - 1);
      if (entry.count === 0) {
        if (now < entry.holdUntil) {
          // Prevent subscribe/unsubscribe storms around threshold oscillation.
          entry.state = "ACTIVE";
          this.refs.set(stream, entry);
          this.duplicateSuppressed += 1;
          continue;
        }
        entry.state = "UNSUBSCRIBE_PENDING";
        this.refs.delete(stream);
        this.desired.delete(stream);
        removed.push(stream);
      } else {
        this.refs.set(stream, entry);
      }
    }
    return removed;
  }

  markRequested(streams: string[]) {
    for (const stream of streams) {
      const entry = this.refs.get(stream);
      if (!entry) continue;
      entry.state = "REQUESTED";
      this.refs.set(stream, entry);
    }
  }

  markActive(streams: string[]) {
    for (const stream of streams) {
      const entry = this.refs.get(stream);
      if (!entry) continue;
      entry.state = "ACTIVE";
      this.refs.set(stream, entry);
    }
  }

  markInactive(streams: string[]) {
    for (const stream of streams) {
      const entry = this.refs.get(stream);
      if (!entry) continue;
      entry.state = "INACTIVE";
      this.refs.set(stream, entry);
    }
  }

  getState(symbol: string, kind: DeepStreamKind): SubscriptionLifecycleState {
    return this.refs.get(toBinanceStreamName(symbol, kind))?.state ?? "INACTIVE";
  }

  refCount(symbol: string, kind: DeepStreamKind) {
    return this.refs.get(toBinanceStreamName(symbol, kind))?.count ?? 0;
  }

  desiredStreams() {
    return [...this.desired];
  }

  wouldExceedLimit(additional: number) {
    return this.desired.size + additional > BINANCE_MAX_STREAMS_PER_CONNECTION;
  }

  telemetry() {
    const stateCounts: Record<SubscriptionLifecycleState, number> = {
      REQUESTED: 0,
      ACTIVE: 0,
      UNSUBSCRIBE_PENDING: 0,
      INACTIVE: 0,
    };
    for (const row of this.refs.values()) {
      stateCounts[row.state] += 1;
    }
    return {
      desiredStreams: this.desired.size,
      duplicateSubscriptionSuppressed: this.duplicateSuppressed,
      leaseCapacityRejected: this.leaseCapacityRejected,
      activeScannerLeases: this.leases.size,
      stateCounts,
    };
  }

  reset() {
    this.refs.clear();
    this.desired.clear();
    this.leases.clear();
    this.duplicateSuppressed = 0;
    this.leaseCapacityRejected = 0;
  }
}
