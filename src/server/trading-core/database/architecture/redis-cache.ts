import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import type { CacheOptions } from "@/src/server/trading-core/database/architecture/database-types";

export class TradingCoreCache {
  private readonly memory = new Map<string, { value: unknown; expiresAt: number }>();

  async get<T>(key: string, options: CacheOptions): Promise<T | null> {
    const cacheKey = this.key(key, options.namespace);
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get(cacheKey).catch((error) => {
        logger.warn({ error }, "Trading core Redis cache read failed");
        return null;
      });
      return raw ? (JSON.parse(raw) as T) : null;
    }
    const cached = this.memory.get(cacheKey);
    if (!cached || cached.expiresAt <= Date.now()) {
      this.memory.delete(cacheKey);
      return null;
    }
    return cached.value as T;
  }

  async set<T>(key: string, value: T, options: CacheOptions) {
    const cacheKey = this.key(key, options.namespace);
    const redis = getRedis();
    if (redis) {
      await redis.set(cacheKey, JSON.stringify(value), "EX", options.ttlSec).catch((error) => {
        logger.warn({ error }, "Trading core Redis cache write failed");
      });
      return;
    }
    this.memory.set(cacheKey, { value, expiresAt: Date.now() + options.ttlSec * 1000 });
  }

  async del(key: string, namespace?: string) {
    const cacheKey = this.key(key, namespace);
    const redis = getRedis();
    if (redis) await redis.del(cacheKey).catch(() => null);
    this.memory.delete(cacheKey);
  }

  private key(key: string, namespace = "default") {
    return `trading-core:cache:${namespace}:${key}`;
  }
}
