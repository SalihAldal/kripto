import { logger } from "@/lib/logger";
import type { DecisionEngineJobPayload } from "@/src/server/decision-engine/decision-engine.types";

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onDecisionEngineEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitDecisionEngineEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Decision engine event listener failed");
    }
  }
}

export type { DecisionEngineJobPayload };
