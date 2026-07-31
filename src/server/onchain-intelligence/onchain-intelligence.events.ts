import { logger } from "@/lib/logger";
import { ONCHAIN_EVENT } from "@/src/server/onchain-intelligence/onchain-intelligence.types";

export { ONCHAIN_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onOnChainEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitOnChainEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "On-chain intelligence event listener failed");
    }
  }
}
