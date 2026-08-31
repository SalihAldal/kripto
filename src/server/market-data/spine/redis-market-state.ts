import type { SharedKv } from "@/src/server/market-data/spine/shared-kv";
import type { SymbolMarketSnapshot } from "@/src/server/market-data/spine/events";

const SNAPSHOT_HASH = "md:snap";
const UNIVERSE_KEY = "md:universe";
const TELEMETRY_KEY = "md:telemetry";
const PUBSUB_CHANNEL = "md:tick";

export class RedisMarketState {
  private dirty = new Map<string, string>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  lastFlushAt = 0;
  lastLatencyMs = 0;
  flushErrors = 0;

  constructor(private kv: SharedKv) {}

  setKv(kv: SharedKv) {
    this.kv = kv;
  }

  start(intervalMs = 400) {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, intervalMs);
  }

  stop() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  queueSnapshot(row: SymbolMarketSnapshot) {
    this.dirty.set(
      row.symbol,
      JSON.stringify({
        s: row.symbol,
        p: row.lastPrice,
        o: row.openPrice,
        c: row.change24h,
        q: row.quoteVolume24h,
        v: row.baseVolume24h,
        h: row.high24h,
        l: row.low24h,
        e: row.eventTime,
        t: row.lastUpdateAt,
      }),
    );
  }

  async flush() {
    if (this.dirty.size === 0) return;
    const started = Date.now();
    const batch = [...this.dirty.entries()];
    this.dirty.clear();
    try {
      for (const [symbol, payload] of batch) {
        await this.kv.hset(SNAPSHOT_HASH, symbol, payload);
      }
      await this.kv.publish?.(PUBSUB_CHANNEL, String(batch.length));
      this.lastFlushAt = Date.now();
      this.lastLatencyMs = Date.now() - started;
    } catch {
      this.flushErrors += 1;
      for (const [symbol, payload] of batch) {
        if (!this.dirty.has(symbol)) this.dirty.set(symbol, payload);
      }
    }
  }

  async readAll(): Promise<SymbolMarketSnapshot[]> {
    const hash = await this.kv.hgetall(SNAPSHOT_HASH);
    const now = Date.now();
    const rows: SymbolMarketSnapshot[] = [];
    for (const payload of Object.values(hash)) {
      try {
        const parsed = JSON.parse(payload) as {
          s: string;
          p: number;
          o: number;
          c: number;
          q: number;
          v: number;
          h: number;
          l: number;
          e: number;
          t: number;
        };
        rows.push({
          symbol: parsed.s,
          lastPrice: parsed.p,
          previousPrice: parsed.p,
          openPrice: parsed.o,
          change24h: parsed.c,
          high24h: parsed.h,
          low24h: parsed.l,
          quoteVolume24h: parsed.q,
          baseVolume24h: parsed.v,
          eventTime: parsed.e,
          localReceiveTime: parsed.t,
          lastUpdateAt: parsed.t,
          stale: now - parsed.t > 5_000,
          rolling: {
            return1s: null,
            return5s: null,
            return15s: null,
            return30s: null,
            return1m: null,
            return3m: null,
            return5m: null,
            return15m: null,
            volumeDelta: null,
            quoteVolumeDelta: null,
          },
        });
      } catch {
        // ignore malformed hash field
      }
    }
    return rows;
  }

  async writeUniverse(symbols: string[]) {
    await this.kv.set(UNIVERSE_KEY, JSON.stringify(symbols), 6 * 60 * 60);
  }

  async readUniverse(): Promise<string[]> {
    const raw = await this.kv.get(UNIVERSE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async writeTelemetry(payload: unknown) {
    await this.kv.set(TELEMETRY_KEY, JSON.stringify(payload), 30);
  }
}
