import { logger } from "@/lib/logger";
import { STRATEGY_SELECTOR_EVENT } from "@/src/server/strategy-selector/strategy-selector.types";

export { STRATEGY_SELECTOR_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onStrategySelectorEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitStrategySelectorEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Strategy selector event listener failed");
    }
  }
}
