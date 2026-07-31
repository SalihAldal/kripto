import { logger } from "@/lib/logger";
import { EXIT_TIMING_EVENT } from "@/src/server/exit-timing/exit-timing.types";

export { EXIT_TIMING_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onExitTimingEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitExitTimingEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Exit timing event listener failed");
    }
  }
}
