import { logger } from "@/lib/logger";
import { NEWS_EVENT } from "@/src/server/news-intelligence/news-intelligence.types";

export { NEWS_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onNewsEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitNewsEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "News intelligence event listener failed");
    }
  }
}
