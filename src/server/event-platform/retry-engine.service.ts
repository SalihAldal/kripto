import { getPendingRetries } from "@/src/server/event-platform/event-platform.repository";
import { publishEvent } from "@/src/server/event-platform/event-bus.service";
import { addToDeadLetter } from "@/src/server/event-platform/dead-letter.service";
import { emitPlatformEvent, PLATFORM_EVENT } from "@/src/server/event-platform/event-platform.events";
import { prisma } from "@/src/server/db/prisma";
import type { CanonicalEvent } from "@/src/server/event-platform/event-platform.types";
import type { AggregateType, PlatformModuleType } from "@prisma/client";

const MAX_BACKOFF_MS = 300_000;

export function calculateBackoff(attempt: number, baseMs = 1000): number {
  return Math.min(MAX_BACKOFF_MS, baseMs * Math.pow(2, attempt));
}

export async function scheduleRetryOnFailure(event: CanonicalEvent, errorMessage: string, maxAttempts = 5) {
  const metadata = await prisma.eventMetadata.findFirst({ where: { eventStore: { eventId: event.eventId } } });
  const attempt = (metadata?.retryCount ?? 0) + 1;
  if (attempt >= maxAttempts) {
    await addToDeadLetter(event.eventId, event.eventType, "RETRY_EXHAUSTED", event.payload, errorMessage);
    return { exhausted: true };
  }
  const backoffMs = calculateBackoff(attempt);
  const row = await prisma.retryEvent.create({
    data: {
      retryKey: `rty_${event.eventId}_${attempt}`,
      originalEventId: event.eventId,
      eventType: event.eventType,
      payload: event.payload as never,
      attempt,
      maxAttempts,
      nextRetryAt: new Date(Date.now() + backoffMs),
      backoffMs,
      lastError: errorMessage,
    },
  });
  emitPlatformEvent(PLATFORM_EVENT.RETRY_SCHEDULED, { retryKey: row.retryKey, attempt, nextRetryAt: row.nextRetryAt });
  return { scheduled: true, retryKey: row.retryKey, nextRetryAt: row.nextRetryAt };
}

export async function processPendingRetries(limit = 50) {
  const pending = await getPendingRetries(limit);
  let succeeded = 0;
  let failed = 0;

  for (const retry of pending) {
    try {
      const payload = retry.payload as Record<string, unknown>;
      await publishEvent({
        eventId: retry.originalEventId,
        correlationId: String(payload.correlationId ?? retry.originalEventId),
        aggregateId: String(payload.aggregateId ?? "unknown"),
        aggregateType: (payload.aggregateType as AggregateType) ?? "PLATFORM",
        eventType: retry.eventType,
        sourceModule: (payload.sourceModule as PlatformModuleType) ?? "EVENT_PLATFORM",
        payload,
        schemaVersion: Number(payload.schemaVersion ?? 1),
        environment: String(payload.environment ?? "production"),
      }, { idempotencyKey: `retry:${retry.retryKey}` });

      await prisma.retryEvent.update({ where: { id: retry.id }, data: { status: "COMPLETED" } });
      succeeded++;
    } catch (error) {
      const nextAttempt = retry.attempt + 1;
      if (nextAttempt >= retry.maxAttempts) {
        await addToDeadLetter(retry.originalEventId, retry.eventType, "RETRY_EXHAUSTED", retry.payload as Record<string, unknown>, (error as Error).message);
        await prisma.retryEvent.update({ where: { id: retry.id }, data: { status: "FAILED", lastError: (error as Error).message } });
      } else {
        const backoffMs = calculateBackoff(nextAttempt, retry.backoffMs);
        await prisma.retryEvent.update({
          where: { id: retry.id },
          data: { attempt: nextAttempt, nextRetryAt: new Date(Date.now() + backoffMs), lastError: (error as Error).message, backoffMs },
        });
      }
      failed++;
    }
  }

  return { processed: pending.length, succeeded, failed };
}

export async function manualRetry(retryKey: string) {
  const retry = await prisma.retryEvent.findUnique({ where: { retryKey } });
  if (!retry) return { retried: false };
  await prisma.retryEvent.update({ where: { retryKey }, data: { nextRetryAt: new Date(), status: "PENDING" } });
  return processPendingRetries(1);
}
