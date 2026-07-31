import { checkIdempotencyKey } from "@/src/server/event-platform/event-platform.repository";
import { moveDuplicateToDeadLetter } from "@/src/server/event-platform/dead-letter.service";
import type { CanonicalEvent } from "@/src/server/event-platform/event-platform.types";

export async function ensureIdempotent(event: CanonicalEvent, idempotencyKey: string): Promise<{ duplicate: boolean; existingEventId?: string }> {
  const existing = await checkIdempotencyKey(idempotencyKey);
  if (existing?.eventStore) {
    await moveDuplicateToDeadLetter(event);
    return { duplicate: true, existingEventId: existing.eventStore.eventId };
  }
  return { duplicate: false };
}

export function buildIdempotencyKey(module: string, action: string, entityId: string): string {
  return `${module}:${action}:${entityId}`;
}
