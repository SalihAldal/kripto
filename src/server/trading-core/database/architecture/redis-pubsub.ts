import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import type { PubSubMessage } from "@/src/server/trading-core/database/architecture/database-types";

type Handler = (message: PubSubMessage) => void | Promise<void>;

export class TradingCorePubSub {
  private readonly memoryHandlers = new Map<string, Set<Handler>>();

  async publish(channel: string, message: Omit<PubSubMessage, "publishedAt">) {
    const payload: PubSubMessage = { ...message, publishedAt: new Date().toISOString() };
    const redis = getRedis();
    if (redis) {
      await redis.publish(this.channel(channel), JSON.stringify(payload)).catch((error) => {
        logger.warn({ error, channel }, "Trading core Redis publish failed");
      });
      return;
    }
    for (const handler of this.memoryHandlers.get(channel) ?? []) {
      await Promise.resolve(handler(payload)).catch((error) => logger.warn({ error, channel }, "Memory pubsub handler failed"));
    }
  }

  subscribeMemory(channel: string, handler: Handler) {
    const handlers = this.memoryHandlers.get(channel) ?? new Set<Handler>();
    handlers.add(handler);
    this.memoryHandlers.set(channel, handlers);
    return () => handlers.delete(handler);
  }

  channel(channel: string) {
    return `trading-core:${channel}`;
  }
}
