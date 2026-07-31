import Redis from "ioredis";
import { env } from "@/lib/config";
import { logger } from "@/lib/logger";

let redisClient: Redis | null = null;

export function getRedis() {
  if (!env.REDIS_URL) {
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    redisClient.on("error", (err) => logger.warn({ err }, "Redis baglanti hatasi"));
  }

  return redisClient;
}
