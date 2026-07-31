import type { InferenceArtifact, DecisionEngineV2Prediction } from "@/src/server/decision-engine-v2/decision-engine-v2.types";

let cachedArtifact: InferenceArtifact | null = null;
let cachedModelId: string | null = null;
let cachedModelVersion: string | null = null;
let cachedAt = 0;

const predictionCache = new Map<string, { prediction: DecisionEngineV2Prediction; expiresAt: number }>();

export function setCachedInferenceModel(input: {
  modelId: string;
  modelVersion: string;
  artifact: InferenceArtifact;
}) {
  cachedModelId = input.modelId;
  cachedModelVersion = input.modelVersion;
  cachedArtifact = input.artifact;
  cachedAt = Date.now();
  predictionCache.clear();
}

export function getCachedInferenceArtifact() {
  return cachedArtifact;
}

export function getCachedInferenceModelMeta() {
  if (!cachedModelId || !cachedModelVersion) return null;
  return { modelId: cachedModelId, modelVersion: cachedModelVersion, cachedAt };
}

export function getCachedPrediction(cacheKey: string) {
  const row = predictionCache.get(cacheKey);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    predictionCache.delete(cacheKey);
    return null;
  }
  return row.prediction;
}

export function setCachedPrediction(cacheKey: string, prediction: DecisionEngineV2Prediction, ttlMs: number) {
  predictionCache.set(cacheKey, { prediction, expiresAt: Date.now() + ttlMs });
}

export function clearPredictionCache() {
  predictionCache.clear();
}

export function getPredictionCacheSize() {
  return predictionCache.size;
}
