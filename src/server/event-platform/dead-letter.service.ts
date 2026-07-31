import { addDeadLetter } from "@/src/server/event-platform/event-platform.repository";
import { emitPlatformEvent, PLATFORM_EVENT } from "@/src/server/event-platform/event-platform.events";
import type { CanonicalEvent } from "@/src/server/event-platform/event-platform.types";
import type { DeadLetterReason } from "@prisma/client";

export async function addToDeadLetter(
  originalEventId: string,
  eventType: string,
  reason: DeadLetterReason,
  payload: Record<string, unknown>,
  errorMessage?: string,
) {
  const row = await addDeadLetter(originalEventId, eventType, reason, payload, errorMessage);
  emitPlatformEvent(PLATFORM_EVENT.DLQ_ADDED, { dlqKey: row.dlqKey, reason });
  return row;
}

export async function processDeadLetterQueue(limit = 20) {
  const { listDeadLetters } = await import("@/src/server/event-platform/event-platform.repository");
  const items = await listDeadLetters(limit, false);
  return { processed: items.length, items };
}

export async function resolveDeadLetter(dlqKey: string) {
  const { prisma } = await import("@/src/server/db/prisma");
  return prisma.deadLetterEvent.update({
    where: { dlqKey },
    data: { resolved: true, resolvedAt: new Date() },
  });
}

export async function moveExpiredToDeadLetter(event: CanonicalEvent) {
  return addToDeadLetter(event.eventId, event.eventType, "EXPIRED", event.payload);
}

export async function moveDuplicateToDeadLetter(event: CanonicalEvent) {
  return addToDeadLetter(event.eventId, event.eventType, "DUPLICATE", event.payload, "Duplicate idempotency key");
}

export async function listDeadLetterEvents(limit = 50, resolved = false) {
  const { listDeadLetters } = await import("@/src/server/event-platform/event-platform.repository");
  return listDeadLetters(limit, resolved);
}
