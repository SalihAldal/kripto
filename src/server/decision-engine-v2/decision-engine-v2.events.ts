export const DECISION_ENGINE_V2_EVENT = {
  PREDICTION_MADE: "DecisionEngineV2PredictionMade",
  MODEL_TRAINED: "DecisionEngineV2ModelTrained",
  MODEL_PROMOTED: "DecisionEngineV2ModelPromoted",
  MODEL_ROLLED_BACK: "DecisionEngineV2ModelRolledBack",
  SHADOW_PERFORMANCE_UPDATED: "DecisionEngineV2ShadowPerformanceUpdated",
  FEATURE_IMPORTANCE_UPDATED: "DecisionEngineV2FeatureImportanceUpdated",
} as const;

type EventHandler = (payload: Record<string, unknown>) => void;
const handlers = new Map<string, Set<EventHandler>>();

export function onDecisionEngineV2Event(event: string, handler: EventHandler) {
  const set = handlers.get(event) ?? new Set();
  set.add(handler);
  handlers.set(event, set);
  return () => set.delete(handler);
}

export function emitDecisionEngineV2Event(event: string, payload: Record<string, unknown>) {
  const set = handlers.get(event);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch {
      // observer isolation
    }
  }
}
