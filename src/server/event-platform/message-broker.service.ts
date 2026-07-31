import { createHash } from "node:crypto";
import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { getRedis } from "@/lib/redis";
import type { MessageBrokerType } from "@prisma/client";
import type { CanonicalEvent } from "@/src/server/event-platform/event-platform.types";

export type BrokerPublishResult = { brokerMessageId: string; brokerType: MessageBrokerType };

export interface IMessageBroker {
  readonly brokerType: MessageBrokerType;
  publish(topic: string, event: CanonicalEvent, delayMs?: number): Promise<BrokerPublishResult>;
  subscribe(topic: string, handler: (event: CanonicalEvent) => Promise<void>): Promise<() => void>;
  getQueueLength(topic: string): Promise<number>;
}

class RedisStreamBroker implements IMessageBroker {
  readonly brokerType: MessageBrokerType = "REDIS_STREAMS";
  private readonly streamPrefix = "event-platform:stream:";

  async publish(topic: string, event: CanonicalEvent, delayMs = 0): Promise<BrokerPublishResult> {
    const redis = getRedis();
    const messageId = `${Date.now()}-${event.eventId}`;
    if (!redis) {
      return { brokerMessageId: messageId, brokerType: "IN_MEMORY" };
    }
    if (delayMs > 0) {
      await redis.zadd(`${this.streamPrefix}delayed:${topic}`, Date.now() + delayMs, JSON.stringify(event));
    } else {
      await redis.xadd(this.streamPrefix + topic, "*", "event", JSON.stringify(event));
    }
    return { brokerMessageId: messageId, brokerType: this.brokerType };
  }

  async subscribe(topic: string, handler: (event: CanonicalEvent) => Promise<void>) {
    const redis = getRedis();
    if (!redis) return () => undefined;
    let running = true;
    const poll = async () => {
      while (running) {
        try {
          const results = await redis.xread("BLOCK", 2000, "STREAMS", this.streamPrefix + topic, "$");
          if (results) {
            for (const [, messages] of results) {
              for (const [, fields] of messages) {
                const raw = fields[1];
                if (raw) await handler(JSON.parse(raw) as CanonicalEvent);
              }
            }
          }
        } catch (error) {
          logger.warn({ topic, error: (error as Error).message }, "Redis stream consume failed");
        }
      }
    };
    void poll();
    return () => { running = false; };
  }

  async getQueueLength(topic: string) {
    const redis = getRedis();
    if (!redis) return 0;
    return redis.xlen(this.streamPrefix + topic).catch(() => 0);
  }
}

class InMemoryBroker implements IMessageBroker {
  readonly brokerType: MessageBrokerType = "IN_MEMORY";
  private readonly topics = new Map<string, Array<(event: CanonicalEvent) => Promise<void>>>();
  private readonly queues = new Map<string, number>();

  async publish(topic: string, event: CanonicalEvent, delayMs = 0): Promise<BrokerPublishResult> {
    const handlers = this.topics.get(topic) ?? [];
    this.queues.set(topic, (this.queues.get(topic) ?? 0) + 1);
    const deliver = () => {
      for (const h of handlers) void h(event).catch(() => null);
      this.queues.set(topic, Math.max(0, (this.queues.get(topic) ?? 1) - 1));
    };
    if (delayMs > 0) setTimeout(deliver, delayMs);
    else setImmediate(deliver);
    return { brokerMessageId: event.eventId, brokerType: this.brokerType };
  }

  async subscribe(topic: string, handler: (event: CanonicalEvent) => Promise<void>) {
    const list = this.topics.get(topic) ?? [];
    list.push(handler);
    this.topics.set(topic, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  async getQueueLength(topic: string) {
    return this.queues.get(topic) ?? 0;
  }
}

class RabbitMqBrokerStub implements IMessageBroker {
  readonly brokerType: MessageBrokerType = "RABBITMQ";

  async publish(topic: string, event: CanonicalEvent, delayMs = 0) {
    const broker = getActiveBroker();
    if (broker.brokerType === "RABBITMQ") throw new Error("RabbitMQ not configured");
    return broker.publish(topic, event, delayMs);
  }

  async subscribe(topic: string, handler: (event: CanonicalEvent) => Promise<void>) {
    return getActiveBroker().subscribe(topic, handler);
  }

  async getQueueLength(topic: string) {
    return getActiveBroker().getQueueLength(topic);
  }
}

let activeBroker: IMessageBroker | null = null;

export function getActiveBroker(): IMessageBroker {
  if (activeBroker) return activeBroker;
  const preferred = (process.env.EVENT_BROKER_TYPE ?? "REDIS_STREAMS") as MessageBrokerType;
  if (preferred === "RABBITMQ" && process.env.RABBITMQ_URL) {
    activeBroker = new RabbitMqBrokerStub();
  } else if (preferred === "REDIS_STREAMS" && env.REDIS_URL) {
    activeBroker = new RedisStreamBroker();
  } else {
    activeBroker = new InMemoryBroker();
  }
  return activeBroker;
}

export function signEvent(event: CanonicalEvent, secret: string): string {
  const payload = JSON.stringify({ eventId: event.eventId, eventType: event.eventType, payload: event.payload, timestamp: event.timestamp });
  return createHash("sha256").update(`${secret}:${payload}`).digest("hex");
}

export function verifyEventSignature(event: CanonicalEvent, signature: string, secret: string): boolean {
  return signEvent(event, secret) === signature;
}

export const TOPICS = {
  DOMAIN: "domain.events",
  INFRASTRUCTURE: "infrastructure.events",
  REPLAY: "replay.events",
  DLQ: "dead-letter.events",
  DELAYED: "delayed.events",
  PRIORITY: "priority.events",
} as const;
