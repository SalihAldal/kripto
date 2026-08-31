export type DeepStreamKind = "aggTrade" | "bookTicker" | "kline_1m" | "depth";

export type SubscriptionOwner = string;

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
};

export class DynamicSubscriptionManager {
  readonly instanceId = `dynamic-sub-manager:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
  private readonly refs = new Map<string, RefEntry>();
  private readonly desired = new Set<string>();

  subscribe(symbol: string, kinds: DeepStreamKind[], owner: SubscriptionOwner): string[] {
    const added: string[] = [];
    for (const kind of kinds) {
      const stream = toBinanceStreamName(symbol, kind);
      const entry = this.refs.get(stream) ?? { count: 0, owners: new Map() };
      const ownerCount = entry.owners.get(owner) ?? 0;
      entry.owners.set(owner, ownerCount + 1);
      entry.count += 1;
      this.refs.set(stream, entry);
      if (entry.count === 1) {
        this.desired.add(stream);
        added.push(stream);
      }
    }
    return added;
  }

  unsubscribe(symbol: string, kinds: DeepStreamKind[], owner: SubscriptionOwner): string[] {
    const removed: string[] = [];
    for (const kind of kinds) {
      const stream = toBinanceStreamName(symbol, kind);
      const entry = this.refs.get(stream);
      if (!entry) continue;
      const ownerCount = entry.owners.get(owner) ?? 0;
      if (ownerCount <= 0) continue;
      if (ownerCount === 1) entry.owners.delete(owner);
      else entry.owners.set(owner, ownerCount - 1);
      entry.count = Math.max(0, entry.count - 1);
      if (entry.count === 0) {
        this.refs.delete(stream);
        this.desired.delete(stream);
        removed.push(stream);
      } else {
        this.refs.set(stream, entry);
      }
    }
    return removed;
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

  reset() {
    this.refs.clear();
    this.desired.clear();
  }
}
