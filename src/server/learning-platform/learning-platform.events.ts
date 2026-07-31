export const LEARNING_PLATFORM_EVENT = {
  DATASET_BUILT: "LearningPlatformDatasetBuilt",
  MODEL_TRAINED: "LearningPlatformModelTrained",
  CANDIDATE_EVALUATED: "LearningPlatformCandidateEvaluated",
  REPORT_GENERATED: "LearningPlatformReportGenerated",
  COIN_PROFILE_UPDATED: "LearningPlatformCoinProfileUpdated",
} as const;

type Handler = (payload: Record<string, unknown>) => void;
const handlers = new Map<string, Set<Handler>>();

export function onLearningPlatformEvent(event: string, handler: Handler) {
  const set = handlers.get(event) ?? new Set();
  set.add(handler);
  handlers.set(event, set);
  return () => set.delete(handler);
}

export function emitLearningPlatformEvent(event: string, payload: Record<string, unknown>) {
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
