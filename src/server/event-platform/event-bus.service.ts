import { EventEmitter } from "node:events";
import { env } from "@/lib/config";
import type { CanonicalEvent, EventHandler, PublishOptions, SubscribeFilter } from "@/src/server/event-platform/event-platform.types";
import {
  generateEventId,
  persistEvent,
  getNextSequence,
  checkIdempotencyKey,
  searchEvents,
} from "@/src/server/event-platform/event-platform.repository";
import { getActiveBroker, signEvent, TOPICS } from "@/src/server/event-platform/message-broker.service";
import { validateEventSchema } from "@/src/server/event-platform/schema-validator.service";
import { emitPlatformEvent, PLATFORM_EVENT } from "@/src/server/event-platform/event-platform.events";
import { scheduleRetryOnFailure } from "@/src/server/event-platform/retry-engine.service";
import { addToDeadLetter } from "@/src/server/event-platform/dead-letter.service";
import type { AggregateType, PlatformModuleType } from "@prisma/client";

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const subscriptions = new Map<string, { filter: SubscribeFilter; handler: EventHandler }>();

function matchesFilter(event: CanonicalEvent, filter: SubscribeFilter): boolean {
  if (filter.eventTypes?.length && !filter.eventTypes.includes(event.eventType)) return false;
  if (filter.sourceModules?.length && !filter.sourceModules.includes(event.sourceModule)) return false;
  if (filter.aggregateTypes?.length && !filter.aggregateTypes.includes(event.aggregateType)) return false;
  if (filter.aggregateId && event.aggregateId !== filter.aggregateId) return false;
  return true;
}

function resolveTopic(priority?: string): string {
  if (priority === "CRITICAL" || priority === "HIGH") return TOPICS.PRIORITY;
  return TOPICS.DOMAIN;
}

export async function publishEvent(
  input: Omit<CanonicalEvent, "eventId" | "timestamp"> & { eventId?: string; timestamp?: string },
  options: PublishOptions = {},
): Promise<CanonicalEvent> {
  if (options.idempotencyKey) {
    const existing = await checkIdempotencyKey(options.idempotencyKey);
    if (existing?.eventStore) {
      return {
        eventId: existing.eventStore.eventId,
        correlationId: existing.eventStore.correlationId,
        causationId: existing.eventStore.causationId ?? undefined,
        aggregateId: existing.eventStore.aggregateId,
        aggregateType: existing.eventStore.aggregateType,
        eventType: existing.eventStore.eventType,
        sourceModule: existing.eventStore.sourceModule,
        targetModule: existing.eventStore.targetModule ?? undefined,
        timestamp: existing.eventStore.publishedAt.toISOString(),
        payload: existing.eventStore.payload as Record<string, unknown>,
        schemaVersion: existing.eventStore.schemaVersion,
        environment: existing.eventStore.environment,
      };
    }
  }

  const validation = await validateEventSchema(input.eventType, input.payload, input.schemaVersion ?? 1);
  if (!validation.valid) {
    await addToDeadLetter(input.eventId ?? generateEventId(), input.eventType, "INVALID", input.payload as Record<string, unknown>, validation.errors.join("; "));
    throw new Error(`Schema validation failed: ${validation.errors.join("; ")}`);
  }

  const partitionKey = options.partitionKey ?? `${input.aggregateType}:${input.aggregateId}`;
  const sequenceNumber = await getNextSequence(partitionKey);

  const event: CanonicalEvent = {
    eventId: input.eventId ?? generateEventId(),
    correlationId: input.correlationId,
    causationId: options.causationId ?? input.causationId,
    aggregateId: input.aggregateId,
    aggregateType: input.aggregateType,
    eventType: input.eventType,
    sourceModule: input.sourceModule,
    targetModule: options.targetModule ?? input.targetModule,
    timestamp: input.timestamp ?? new Date().toISOString(),
    payload: input.payload,
    metadata: input.metadata,
    schemaVersion: options.schemaVersion ?? input.schemaVersion ?? 1,
    environment: input.environment ?? env.APP_ENV ?? "production",
    priority: options.priority,
    idempotencyKey: options.idempotencyKey,
    partitionKey,
  };

  const secret = process.env.EVENT_SIGNING_SECRET ?? "";
  const signature = secret ? signEvent(event, secret) : undefined;
  await persistEvent(event, sequenceNumber, signature);

  const broker = getActiveBroker();
  const topic = resolveTopic(options.priority);
  await broker.publish(topic, event, options.delayMs);

  emitter.emit("event", event);
  for (const [, sub] of subscriptions) {
    if (matchesFilter(event, sub.filter)) {
      try {
        await sub.handler(event);
      } catch (error) {
        await scheduleRetryOnFailure(event, (error as Error).message);
      }
    }
  }

  emitPlatformEvent(PLATFORM_EVENT.EVENT_PUBLISHED, { eventId: event.eventId, eventType: event.eventType });
  return event;
}

export function subscribeEvents(subscriptionId: string, filter: SubscribeFilter, handler: EventHandler) {
  subscriptions.set(subscriptionId, { filter, handler });
  return () => subscriptions.delete(subscriptionId);
}

export async function publishBatch(events: Array<Omit<CanonicalEvent, "eventId" | "timestamp">>, options: PublishOptions = {}) {
  const results: CanonicalEvent[] = [];
  for (const e of events) {
    results.push(await publishEvent(e, options));
  }
  return results;
}

export async function replayEventsFromStore(input: {
  eventType?: string;
  aggregateType?: AggregateType;
  aggregateId?: string;
  correlationId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  handler?: EventHandler;
}) {
  const events = await searchEvents(input);
  for (const row of events) {
    const event: CanonicalEvent = {
      eventId: row.eventId,
      correlationId: row.correlationId,
      causationId: row.causationId ?? undefined,
      aggregateId: row.aggregateId,
      aggregateType: row.aggregateType,
      eventType: row.eventType,
      sourceModule: row.sourceModule,
      targetModule: row.targetModule ?? undefined,
      timestamp: row.publishedAt.toISOString(),
      payload: row.payload as Record<string, unknown>,
      schemaVersion: row.schemaVersion,
      environment: row.environment,
    };
    if (input.handler) await input.handler(event);
    emitter.emit("replay", event);
  }
  emitPlatformEvent(PLATFORM_EVENT.EVENT_REPLAYED, { count: events.length });
  return { replayed: events.length, events };
}

export function onBusEvent(listener: (event: CanonicalEvent) => void) {
  emitter.on("event", listener);
  return () => emitter.off("event", listener);
}

export async function publishDomainEvent(
  eventType: string,
  aggregateType: AggregateType,
  aggregateId: string,
  sourceModule: PlatformModuleType,
  payload: Record<string, unknown>,
  correlationId?: string,
  options?: PublishOptions,
) {
  return publishEvent({
    correlationId: correlationId ?? generateEventId(),
    aggregateId,
    aggregateType,
    eventType,
    sourceModule,
    payload,
    schemaVersion: 1,
    environment: env.APP_ENV ?? "production",
  }, options);
}
