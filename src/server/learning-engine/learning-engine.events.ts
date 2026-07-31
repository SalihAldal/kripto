import { logger } from "@/lib/logger";
import { LEARNING_EVENT } from "@/src/server/learning-engine/learning-engine.types";

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export { LEARNING_EVENT };

export function onLearningEngineEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitLearningEngineEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Learning engine event listener failed");
    }
  }
}
