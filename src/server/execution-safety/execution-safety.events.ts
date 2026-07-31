import { logger } from "@/lib/logger";
import { SAFETY_EVENT } from "@/src/server/execution-safety/execution-safety.types";

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export { SAFETY_EVENT };

export function onExecutionSafetyEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitExecutionSafetyEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Execution safety event listener failed");
    }
  }
}
