import { env } from "@/lib/config";
import { createHash } from "node:crypto";
import type { FeatureSnapshotInput } from "@/src/server/observability/decision-observability.types";
import {
  getCachedInferenceArtifact,
  getCachedInferenceModelMeta,
  getCachedPrediction,
  setCachedPrediction,
} from "@/src/server/decision-engine-v2/decision-engine-v2.cache";
import { runInference, buildFallbackArtifact } from "@/src/server/decision-engine-v2/inference.service";
import { buildFeatureVector } from "@/src/server/decision-engine-v2/feature-vector.service";
import {
  persistModelPredictionForSymbol,
  getActiveModel,
  parseArtifactJson,
} from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import { syncInferenceCacheFromRegistry } from "@/src/server/decision-engine-v2/model-registry.service";
import { emitDecisionEngineV2Event, DECISION_ENGINE_V2_EVENT } from "@/src/server/decision-engine-v2/decision-engine-v2.events";
import type { DecisionEngineV2Prediction } from "@/src/server/decision-engine-v2/decision-engine-v2.types";
import { upsertDecisionLogRecord } from "@/src/server/repositories/decision-log.repository";

function predictionCacheKey(symbol: string, features: Record<string, number>) {
  const payload = JSON.stringify({ symbol, features });
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

export async function predictDecisionEngineV2(input: {
  symbol: string;
  decisionId?: string;
  featureSnapshot?: FeatureSnapshotInput | null;
  scannerScore?: number | null;
  momentumScore?: number | null;
  discoveryScore?: number | null;
  marketRegime?: string | null;
  metadata?: Record<string, unknown> | null;
  persist?: boolean;
}): Promise<DecisionEngineV2Prediction> {
  const startedAt = Date.now();
  const features = await buildFeatureVector({
    featureSnapshot: input.featureSnapshot,
    symbol: input.symbol,
    scannerScore: input.scannerScore,
    momentumScore: input.momentumScore,
    discoveryScore: input.discoveryScore,
    marketRegime: input.marketRegime,
    metadata: input.metadata,
  });

  const cacheKey = predictionCacheKey(input.symbol, features);
  if (env.DECISION_ENGINE_V2_PREDICTION_CACHE_TTL_MS > 0) {
    const cached = getCachedPrediction(cacheKey);
    if (cached) return cached;
  }

  let meta = getCachedInferenceModelMeta();
  let artifact = getCachedInferenceArtifact();
  if (!meta || !artifact) {
    await syncInferenceCacheFromRegistry();
    meta = getCachedInferenceModelMeta();
    artifact = getCachedInferenceArtifact();
  }
  if (!artifact || !meta) {
    const model = await getActiveModel();
    artifact = (model ? parseArtifactJson(model.artifactJson) : null) ?? buildFallbackArtifact();
    meta = { modelId: model?.id ?? "fallback", modelVersion: model?.version ?? "bootstrap", cachedAt: Date.now() };
  }

  const base = runInference({
    artifact,
    features,
    modelId: meta.modelId,
    modelVersion: meta.modelVersion,
  });

  const prediction: DecisionEngineV2Prediction = {
    ...base,
    inferenceTimeMs: Number((Date.now() - startedAt).toFixed(2)),
  };

  if (env.DECISION_ENGINE_V2_PREDICTION_CACHE_TTL_MS > 0) {
    setCachedPrediction(cacheKey, prediction, env.DECISION_ENGINE_V2_PREDICTION_CACHE_TTL_MS);
  }

  if (input.persist !== false) {
    await persistModelPredictionForSymbol(input.symbol, prediction, input.decisionId);
  }

  emitDecisionEngineV2Event(DECISION_ENGINE_V2_EVENT.PREDICTION_MADE, {
    symbol: input.symbol,
    decision: prediction.decision,
    confidence: prediction.confidence,
    inferenceTimeMs: prediction.inferenceTimeMs,
    modelId: prediction.modelId,
  });

  return prediction;
}

export async function predictBatchForRecentDecisions(limit = 20) {
  const { prisma } = await import("@/src/server/db/prisma");
  const decisions = await prisma.decisionLog.findMany({
    where: { featureSnapshot: { isNot: null } },
    include: { featureSnapshot: true },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  const results = [];
  for (const row of decisions) {
    const prediction = await predictDecisionEngineV2({
      symbol: row.symbol,
      decisionId: row.decisionId,
      featureSnapshot: row.featureSnapshot as never,
      scannerScore: row.scannerScore,
      momentumScore: row.momentumScore,
      metadata: row.metadata as Record<string, unknown> | null,
      persist: true,
    });
    results.push({ decisionId: row.decisionId, prediction });
  }
  return results;
}

export async function persistPredictionAsObserveOnlyDecision(input: {
  decisionId: string;
  symbol: string;
  prediction: DecisionEngineV2Prediction;
}) {
  await upsertDecisionLogRecord({
    decisionId: input.decisionId,
    symbol: input.symbol,
    decision: input.prediction.decision,
    executionAllowed: false,
    strategyUsed: "DECISION_ENGINE_V2_ML",
    confidence: input.prediction.confidence,
    momentumScore: input.prediction.featuresUsed.momentum,
    regimeScore: input.prediction.featuresUsed.marketRegimeScore,
    scannerScore: input.prediction.featuresUsed.discoveryScore,
    humanSummary: input.prediction.reason,
    metadata: {
      source: "decision-engine-v2",
      modelId: input.prediction.modelId,
      modelVersion: input.prediction.modelVersion,
      rawProbabilities: input.prediction.rawProbabilities,
      calibratedProbabilities: input.prediction.calibratedProbabilities,
      expectedReturn: input.prediction.expectedReturn,
      expectedRisk: input.prediction.expectedRisk,
      inferenceTimeMs: input.prediction.inferenceTimeMs,
    },
    features: {
      momentum: input.prediction.featuresUsed,
      raw: input.prediction.featuresUsed,
    },
  });
}
