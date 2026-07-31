export const EXECUTION_ENGINE_V2_EVENT = {
  ENTRY_EVALUATED: "ExecutionEngineV2EntryEvaluated",
  EXIT_EVALUATED: "ExecutionEngineV2ExitEvaluated",
  ORDER_EXECUTED: "ExecutionEngineV2OrderExecuted",
  ORDER_VERIFIED: "ExecutionEngineV2OrderVerified",
  RECONCILED: "ExecutionEngineV2Reconciled",
  RECOVERY: "ExecutionEngineV2Recovery",
} as const;

type Handler = (payload: Record<string, unknown>) => void;
const handlers = new Map<string, Set<Handler>>();

export function onExecutionEngineV2Event(event: string, handler: Handler) {
  const set = handlers.get(event) ?? new Set();
  set.add(handler);
  handlers.set(event, set);
  return () => set.delete(handler);
}

export function emitExecutionEngineV2Event(event: string, payload: Record<string, unknown>) {
  const set = handlers.get(event);
  if (!set) return;
  for (const h of set) {
    try {
      h(payload);
    } catch {
      /* isolated */
    }
  }
}
