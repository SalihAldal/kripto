import { logger } from "@/lib/logger";
import type { DiscoveryJobPayload } from "@/src/server/discovery/discovery.types";

type DiscoveryEventPayload = Record<string, unknown>;

const listeners = new Set<(event: string, payload: DiscoveryEventPayload) => void>();

export function onDiscoveryEvent(listener: (event: string, payload: DiscoveryEventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitDiscoveryEvent(event: string, payload: DiscoveryEventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Discovery event listener failed");
    }
  }
}

export type { DiscoveryJobPayload };
