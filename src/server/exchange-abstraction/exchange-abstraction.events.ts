import { logger } from "@/lib/logger";
import { EXCHANGE_EVENT } from "@/src/server/exchange-abstraction/exchange-abstraction.types";

export { EXCHANGE_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onExchangeEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitExchangeEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Exchange abstraction event listener failed");
    }
  }
}
