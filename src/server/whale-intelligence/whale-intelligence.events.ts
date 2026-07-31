import { logger } from "@/lib/logger";
import { WHALE_EVENT } from "@/src/server/whale-intelligence/whale-intelligence.types";

export { WHALE_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onWhaleEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitWhaleEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Whale intelligence event listener failed");
    }
  }
}
