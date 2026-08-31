export type SharedKv = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  incrBy(key: string, amount: number): Promise<number>;
  expire(key: string, ttlSec: number): Promise<void>;
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  del(key: string): Promise<void>;
  hset(key: string, field: string, value: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  publish?(channel: string, message: string): Promise<void>;
};

type MemoryRow = { value: string; expiresAt?: number };

export class MemoryKv implements SharedKv {
  private readonly store = new Map<string, MemoryRow>();
  private readonly hashes = new Map<string, Map<string, string>>();

  async get(key: string) {
    const row = this.store.get(key);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return row.value;
  }

  async set(key: string, value: string, ttlSec?: number) {
    this.store.set(key, {
      value,
      expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : undefined,
    });
  }

  async incrBy(key: string, amount: number) {
    const current = Number((await this.get(key)) ?? "0");
    const next = current + amount;
    const existing = this.store.get(key);
    this.store.set(key, { value: String(next), expiresAt: existing?.expiresAt });
    return next;
  }

  async expire(key: string, ttlSec: number) {
    const row = this.store.get(key);
    if (row) row.expiresAt = Date.now() + ttlSec * 1000;
  }

  async setNx(key: string, value: string, ttlSec: number) {
    if (await this.get(key)) return false;
    await this.set(key, value, ttlSec);
    return true;
  }

  async del(key: string) {
    this.store.delete(key);
    this.hashes.delete(key);
  }

  async hset(key: string, field: string, value: string) {
    const hash = this.hashes.get(key) ?? new Map();
    hash.set(field, value);
    this.hashes.set(key, hash);
  }

  async hgetall(key: string) {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash.entries());
  }
}

export function createRedisKvAdapter(client: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  hset(key: string, field: string, value: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  publish?(channel: string, message: string): Promise<number>;
}): SharedKv {
  return {
    async get(key) {
      return client.get(key);
    },
    async set(key, value, ttlSec) {
      if (ttlSec) await client.set(key, value, "EX", ttlSec);
      else await client.set(key, value);
    },
    async incrBy(key, amount) {
      return client.incrby(key, amount);
    },
    async expire(key, ttlSec) {
      await client.expire(key, ttlSec);
    },
    async setNx(key, value, ttlSec) {
      const result = await client.set(key, value, "EX", ttlSec, "NX");
      return Boolean(result);
    },
    async del(key) {
      await client.del(key);
    },
    async hset(key, field, value) {
      await client.hset(key, field, value);
    },
    async hgetall(key) {
      return client.hgetall(key);
    },
    async publish(channel, message) {
      await client.publish?.(channel, message);
    },
  };
}
