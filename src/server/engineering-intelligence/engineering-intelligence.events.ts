import { logger } from "@/lib/logger";
import { ENGINEERING_EVENT } from "@/src/server/engineering-intelligence/engineering-intelligence.types";

export { ENGINEERING_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onEngineeringEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitEngineeringEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Engineering intelligence event listener failed");
    }
  }
}
