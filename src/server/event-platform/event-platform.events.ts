import { logger } from "@/lib/logger";
import { PLATFORM_EVENT } from "@/src/server/event-platform/event-platform.types";

export { PLATFORM_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onPlatformEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitPlatformEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Event platform listener failed");
    }
  }
}
