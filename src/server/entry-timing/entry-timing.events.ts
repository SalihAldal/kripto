import { logger } from "@/lib/logger";
import { ENTRY_TIMING_EVENT } from "@/src/server/entry-timing/entry-timing.types";

export { ENTRY_TIMING_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onEntryTimingEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitEntryTimingEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Entry timing event listener failed");
    }
  }
}
