import { env } from "@/lib/config";
import { execSync } from "node:child_process";
import type { MLModelAlgorithm } from "@prisma/client";
import {
  createMLModel,
  exportTrainingRows,
  persistModelTrainingResult,
  parseArtifactJson,
} from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import {
  buildFeatureVector,
  labelFromDecision,
  labelFromReturn,
} from "@/src/server/decision-engine-v2/feature-vector.service";
import {
  decisionEngineV2MlClient,
  buildFallbackTrainingResult,
} from "@/src/server/decision-engine-v2/ml-service.client";
import { syncInferenceCacheFromRegistry } from "@/src/server/decision-engine-v2/model-registry.service";
import { emitDecisionEngineV2Event, DECISION_ENGINE_V2_EVENT } from "@/src/server/decision-engine-v2/decision-engine-v2.events";
import type { TrainingRowExport } from "@/src/server/decision-engine-v2/decision-engine-v2.types";

function resolveGitCommit() {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function mapAlgorithm(value?: string): MLModelAlgorithm {
  const upper = (value ?? env.DECISION_ENGINE_V2_DEFAULT_ALGORITHM).toUpperCase();
  if (upper === "LIGHTGBM") return "LIGHTGBM";
  if (upper === "XGBOOST") return "XGBOOST";
  if (upper === "CATBOOST") return "CATBOOST";
  return "GRADIENT_BOOSTING";
}

export async function trainDecisionEngineV2Model(input?: {
  algorithm?: MLModelAlgorithm;
  limit?: number;
}) {
  const algorithm = input?.algorithm ?? mapAlgorithm(env.DECISION_ENGINE_V2_DEFAULT_ALGORITHM);
  const limit = input?.limit ?? env.DECISION_ENGINE_V2_TRAINING_LIMIT;
  const rows = await exportTrainingRows(limit);

  const trainingRows: TrainingRowExport[] = [];
  for (const row of rows) {
    if (!row.featureSnapshot) continue;
    const replay = row.replays[0];
    const returnPct = Number(replay?.evaluation?.peakProfitPct ?? replay?.evaluation?.mfePct ?? 0);
    const label = replay?.evaluation
      ? labelFromReturn(returnPct)
      : labelFromDecision(row.decision);
    const features = await buildFeatureVector({
      featureSnapshot: row.featureSnapshot as never,
      symbol: row.symbol,
      scannerScore: row.scannerScore,
      momentumScore: row.momentumScore,
      metadata: row.metadata as Record<string, unknown> | null,
    });
    trainingRows.push({
      features,
      label,
      symbol: row.symbol,
      decisionId: row.decisionId,
      timestamp: row.timestamp.toISOString(),
      returnPct,
    });
  }

  if (trainingRows.length < 30) {
    throw new Error(`Insufficient training rows: ${trainingRows.length} (minimum 30)`);
  }

  const version = `v2.${Date.now()}`;
  const datasetId = `ds_${trainingRows.length}_${Date.now()}`;
  const model = await createMLModel({
    version,
    algorithm,
    featureSetVersion: env.DECISION_ENGINE_V2_FEATURE_SET_VERSION,
    trainingDatasetId: datasetId,
    gitCommit: resolveGitCommit(),
    metadata: { rowCount: trainingRows.length },
  });

  const mlResponse = await decisionEngineV2MlClient.train(trainingRows, algorithm);
  let result;
  if (mlResponse?.artifact) {
    result = {
      modelId: model.id,
      modelKey: model.modelKey,
      version,
      algorithm,
      artifact: mlResponse.artifact,
      validationMetrics: mlResponse.validation_metrics.map((row) => ({
        method: row.method,
        accuracy: row.accuracy,
        f1Score: row.f1_score,
        sampleSize: row.sample_size,
        metrics: row.metrics,
      })),
      featureImportance: mlResponse.feature_importance.map((row) => ({
        featureName: row.feature_name,
        shapValue: row.shap_value,
        gainImportance: row.gain_importance,
        permutationImportance: row.permutation_importance,
      })),
    };
  } else {
    result = buildFallbackTrainingResult({
      modelId: model.id,
      modelKey: model.modelKey,
      version,
      algorithm,
      rows: trainingRows,
    });
  }

  await persistModelTrainingResult(result);
  await syncInferenceCacheFromRegistry();
  emitDecisionEngineV2Event(DECISION_ENGINE_V2_EVENT.MODEL_TRAINED, {
    modelId: model.id,
    version,
    algorithm,
    rows: trainingRows.length,
  });
  return result;
}

export async function loadArtifactForModel(modelId: string) {
  const { prisma } = await import("@/src/server/db/prisma");
  const model = await prisma.mLModel.findUnique({ where: { id: modelId } });
  if (!model) return null;
  return parseArtifactJson(model.artifactJson);
}
