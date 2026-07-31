import { logger } from "@/lib/logger";
import { FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.types";

export { FUSION_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onFusionEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitFusionEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Intelligence fusion event listener failed");
    }
  }
}
