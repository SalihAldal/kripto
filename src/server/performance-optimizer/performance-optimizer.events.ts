import { logger } from "@/lib/logger";
import { PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.types";

export { PERF_OPT_EVENT };

type EventPayload = Record<string, unknown>;
const listeners = new Set<(event: string, payload: EventPayload) => void>();

export function onPerfOptEvent(listener: (event: string, payload: EventPayload) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitPerfOptEvent(event: string, payload: EventPayload = {}) {
  for (const listener of listeners) {
    try { listener(event, payload); } catch (error) {
      logger.warn({ event, error: (error as Error).message }, "PerfOpt event listener failed");
    }
  }
}
