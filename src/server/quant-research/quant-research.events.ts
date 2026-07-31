import { logger } from "@/lib/logger";
import { QUANT_RESEARCH_EVENT } from "@/src/server/quant-research/quant-research.types";

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export { QUANT_RESEARCH_EVENT };

export function onQuantResearchEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitQuantResearchEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try {
      listener(event, payload);
    } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "Quant research event listener failed");
    }
  }
}
