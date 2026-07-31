import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { CanonicalEvent } from "@/src/server/event-platform/event-platform.types";
import type { AggregateType, DeadLetterReason, PlatformModuleType, ReplayScope } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export function generateEventId() {
  return randomUUID();
}

export async function persistEvent(event: CanonicalEvent, sequenceNumber: bigint, signature?: string) {
  return prisma.eventStore.create({
    data: {
      eventId: event.eventId,
      correlationId: event.correlationId,
      causationId: event.causationId,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      eventType: event.eventType,
      sourceModule: event.sourceModule,
      targetModule: event.targetModule,
      schemaVersion: event.schemaVersion,
      environment: event.environment,
      priority: event.priority ?? "NORMAL",
      payload: event.payload as Prisma.InputJsonValue,
      signature,
      sequenceNumber,
      partitionKey: event.partitionKey,
      metadata: event.idempotencyKey
        ? {
            create: {
              idempotencyKey: event.idempotencyKey,
              checksum: createHash("sha256").update(JSON.stringify(event.payload)).digest("hex"),
              tags: [],
            },
          }
        : {
            create: {
              checksum: createHash("sha256").update(JSON.stringify(event.payload)).digest("hex"),
              tags: [],
            },
          },
    },
    include: { metadata: true },
  });
}

export async function getEventById(eventId: string) {
  return prisma.eventStore.findUnique({ where: { eventId }, include: { metadata: true } });
}

export async function searchEvents(input: {
  eventType?: string;
  aggregateType?: AggregateType;
  aggregateId?: string;
  correlationId?: string;
  sourceModule?: PlatformModuleType;
  from?: Date;
  to?: Date;
  limit?: number;
}) {
  return prisma.eventStore.findMany({
    where: {
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      correlationId: input.correlationId,
      sourceModule: input.sourceModule,
      publishedAt: input.from || input.to ? { gte: input.from, lte: input.to } : undefined,
    },
    orderBy: { publishedAt: "asc" },
    take: input.limit ?? 100,
    include: { metadata: true },
  });
}

export async function getNextSequence(partitionKey: string) {
  const last = await prisma.eventStore.findFirst({
    where: { partitionKey },
    orderBy: { sequenceNumber: "desc" },
    select: { sequenceNumber: true },
  });
  return (last?.sequenceNumber ?? BigInt(0)) + BigInt(1);
}

export async function createReplay(scope: ReplayScope, filterCriteria?: Record<string, unknown>) {
  const now = new Date();
  let from: Date | undefined;
  if (scope === "DAY") from = new Date(now.getTime() - 86400_000);
  else if (scope === "WEEK") from = new Date(now.getTime() - 7 * 86400_000);
  else if (scope === "MONTH") from = new Date(now.getTime() - 30 * 86400_000);

  return prisma.eventReplay.create({
    data: {
      replayKey: key("rpl"),
      scope,
      filterCriteria: filterCriteria as Prisma.InputJsonValue,
      fromTimestamp: from,
      toTimestamp: now,
      status: "PENDING",
    },
  });
}

export async function updateReplayProgress(replayId: string, processedCount: number, eventCount: number, status: string, speed?: number) {
  return prisma.eventReplay.update({
    where: { id: replayId },
    data: {
      processedCount,
      eventCount,
      status,
      speed,
      completedAt: status === "COMPLETED" ? new Date() : undefined,
    },
  });
}

export async function addDeadLetter(originalEventId: string, eventType: string, reason: DeadLetterReason, payload: Record<string, unknown>, errorMessage?: string) {
  return prisma.deadLetterEvent.create({
    data: {
      dlqKey: key("dlq"),
      originalEventId,
      eventType,
      reason,
      payload: payload as Prisma.InputJsonValue,
      errorMessage,
    },
  });
}

export async function scheduleRetry(originalEventId: string, eventType: string, payload: Record<string, unknown>, attempt: number, backoffMs: number) {
  return prisma.retryEvent.create({
    data: {
      retryKey: key("rty"),
      originalEventId,
      eventType,
      payload: payload as Prisma.InputJsonValue,
      attempt,
      nextRetryAt: new Date(Date.now() + backoffMs),
      backoffMs,
      status: "PENDING",
    },
  });
}

export async function getPendingRetries(limit = 50) {
  return prisma.retryEvent.findMany({
    where: { status: "PENDING", nextRetryAt: { lte: new Date() } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
  });
}

export async function persistTimeline(input: {
  timelineType: string;
  title: string;
  entries: Record<string, unknown>[];
  aggregateId?: string;
  aggregateType?: AggregateType;
  fromTimestamp?: Date;
  toTimestamp?: Date;
}) {
  return prisma.eventTimeline.create({
    data: {
      timelineKey: key("tl"),
      timelineType: input.timelineType,
      title: input.title,
      entries: input.entries as Prisma.InputJsonValue,
      entryCount: input.entries.length,
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      fromTimestamp: input.fromTimestamp,
      toTimestamp: input.toTimestamp,
    },
  });
}

export async function upsertEventSchema(eventType: string, schema: Record<string, unknown>, version = 1) {
  return prisma.eventSchema.upsert({
    where: { eventType },
    create: { schemaKey: key("sch"), eventType, schema: schema as Prisma.InputJsonValue, version },
    update: { schema: schema as Prisma.InputJsonValue, version },
  });
}

export async function upsertCheckpoint(consumerId: string, pluginType: PlatformModuleType, lastEventId: string, lastSequence: bigint, lag: number, partitionKey = "default") {
  return prisma.consumerCheckpoint.upsert({
    where: { consumerId_pluginType_partitionKey: { consumerId, pluginType, partitionKey } },
    create: { consumerId, pluginType, partitionKey, lastEventId, lastSequence, lag },
    update: { lastEventId, lastSequence, lag },
  });
}

export async function upsertModulePlugin(input: {
  moduleType: PlatformModuleType;
  displayName: string;
  subscribedEvents: string[];
  publishedEvents: string[];
  consumerId?: string;
}) {
  return prisma.modulePluginRegistration.upsert({
    where: { moduleType: input.moduleType },
    create: { pluginKey: key("plg"), ...input },
    update: { displayName: input.displayName, subscribedEvents: input.subscribedEvents, publishedEvents: input.publishedEvents, consumerId: input.consumerId },
  });
}

export async function createSaga(sagaType: string, correlationId: string, steps: Record<string, unknown>[]) {
  return prisma.sagaInstance.create({
    data: {
      sagaKey: key("sga"),
      sagaType,
      correlationId,
      currentStep: steps[0]?.name as string ?? "start",
      steps: steps as Prisma.InputJsonValue,
      status: "STARTED",
    },
  });
}

export async function updateSaga(sagaId: string, data: { currentStep?: string; status?: import("@prisma/client").SagaStatus; context?: Record<string, unknown>; compensation?: Record<string, unknown> }) {
  return prisma.sagaInstance.update({
    where: { id: sagaId },
    data: {
      currentStep: data.currentStep,
      status: data.status,
      context: data.context as Prisma.InputJsonValue,
      compensation: data.compensation as Prisma.InputJsonValue,
      completedAt: data.status === "COMPLETED" || data.status === "COMPENSATED" ? new Date() : undefined,
    },
  });
}

export async function persistObservabilitySnapshot(data: {
  eventRate: number;
  consumerLag: number;
  queueLength: number;
  avgProcessingMs: number;
  failureCount: number;
  replaySpeed?: number;
  workerHealth: number;
  brokerType?: import("@prisma/client").MessageBrokerType;
}) {
  return prisma.eventObservabilitySnapshot.create({
    data: { snapshotKey: key("obs"), ...data },
  });
}

export async function getEventPlatformDashboard() {
  const [events, replays, deadLetters, retries, timelines, schemas, checkpoints, sagas, plugins, observability] = await Promise.all([
    prisma.eventStore.findMany({ orderBy: { publishedAt: "desc" }, take: 50, include: { metadata: true } }),
    prisma.eventReplay.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.deadLetterEvent.findMany({ where: { resolved: false }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.retryEvent.findMany({ where: { status: "PENDING" }, orderBy: { nextRetryAt: "asc" }, take: 30 }),
    prisma.eventTimeline.findMany({ orderBy: { generatedAt: "desc" }, take: 15 }),
    prisma.eventSchema.findMany({ where: { active: true } }),
    prisma.consumerCheckpoint.findMany({ orderBy: { updatedAt: "desc" } }),
    prisma.sagaInstance.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.modulePluginRegistration.findMany(),
    prisma.eventObservabilitySnapshot.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
  ]);
  return { events, replays, deadLetters, retries, timelines, schemas, checkpoints, sagas, plugins, observability };
}

export async function checkIdempotencyKey(idempotencyKey: string) {
  return prisma.eventMetadata.findFirst({ where: { idempotencyKey }, include: { eventStore: true } });
}

export async function markEventProcessed(eventStoreId: string, consumerId: string) {
  return prisma.eventMetadata.update({
    where: { eventStoreId },
    data: { processed: true, processedAt: new Date(), consumerId },
  });
}

export async function listDeadLetters(limit = 50, resolved = false) {
  return prisma.deadLetterEvent.findMany({ where: { resolved }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function listReplays(limit = 20) {
  return prisma.eventReplay.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
