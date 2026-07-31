import { env } from "@/lib/config";
import type { MLModelAlgorithm } from "@prisma/client";
import { trainDecisionEngineV2Model } from "@/src/server/decision-engine-v2/model-training.service";
import {
  getTrainingDatasetByDatasetId,
  listValidDatasetRows,
  createModelCandidate,
} from "@/src/server/learning-platform/learning-platform.repository";
import { buildLabeledDataset } from "@/src/server/learning-platform/dataset-builder.service";
import { evaluateDatasetRows } from "@/src/server/learning-platform/model-evaluation.service";
import { evaluatePromotionCandidate } from "@/src/server/learning-platform/promotion-candidate.service";
import { emitLearningPlatformEvent, LEARNING_PLATFORM_EVENT } from "@/src/server/learning-platform/learning-platform.events";

function mapAlgorithm(value?: string): MLModelAlgorithm {
  const upper = (value ?? env.DECISION_ENGINE_V2_DEFAULT_ALGORITHM).toUpperCase();
  if (upper === "LIGHTGBM") return "LIGHTGBM";
  if (upper === "XGBOOST") return "XGBOOST";
  if (upper === "CATBOOST") return "CATBOOST";
  return "GRADIENT_BOOSTING";
}

export async function runTrainingPipeline(input?: {
  algorithm?: string;
  datasetId?: string;
  limit?: number;
}) {
  let datasetId = input?.datasetId;
  let trainingDatasetId: string | undefined;

  if (!datasetId) {
    const built = await buildLabeledDataset({ limit: input?.limit });
    datasetId = built.datasetId;
    trainingDatasetId = built.trainingDatasetId;
    if (built.valid < env.LEARNING_PLATFORM_MIN_DATASET_ROWS) {
      throw new Error(`Insufficient valid rows: ${built.valid}`);
    }
  } else {
    const ds = await getTrainingDatasetByDatasetId(datasetId);
    if (!ds) throw new Error(`Dataset not found: ${datasetId}`);
    trainingDatasetId = ds.id;
    if (ds.validRowCount < env.LEARNING_PLATFORM_MIN_DATASET_ROWS) {
      throw new Error(`Dataset ${datasetId} has only ${ds.validRowCount} valid rows`);
    }
  }

  const algorithm = mapAlgorithm(input?.algorithm);
  const trainResult = await trainDecisionEngineV2Model({ algorithm, limit: input?.limit });

  const rows = trainingDatasetId
    ? await listValidDatasetRows(trainingDatasetId)
    : [];
  const evalMetrics = rows.length > 0
    ? evaluateDatasetRows(rows.map((r) => ({ labels: r.labels as Record<string, unknown>, decision: r.decision })))
    : null;

  const candidate = await createModelCandidate({
    modelId: trainResult.modelId,
    trainingDatasetId,
    role: "EXPERIMENTAL",
    status: "PENDING",
    profitFactor: evalMetrics?.profitFactor,
    expectancy: evalMetrics?.expectancy,
    maxDrawdown: evalMetrics?.maxDrawdown,
    winRate: evalMetrics ? evalMetrics.accuracy * 100 : undefined,
    sharpe: evalMetrics?.sharpe,
    sortino: evalMetrics?.sortino,
    auc: evalMetrics?.rocAuc,
    metadata: {
      datasetId,
      algorithm,
      trainingRows: trainResult,
      evaluation: evalMetrics,
    },
  });

  const promotionEval = await evaluatePromotionCandidate(trainResult.modelId);

  emitLearningPlatformEvent(LEARNING_PLATFORM_EVENT.MODEL_TRAINED, {
    modelId: trainResult.modelId,
    datasetId,
    candidateId: candidate.id,
  });

  return {
    modelId: trainResult.modelId,
    version: trainResult.version,
    algorithm,
    datasetId,
    candidate,
    evaluation: evalMetrics,
    promotion: promotionEval,
  };
}

export async function evaluateTrainedModel(modelId: string, datasetId?: string) {
  let rows: Array<{ labels: Record<string, unknown>; decision: string }> = [];
  if (datasetId) {
    const ds = await getTrainingDatasetByDatasetId(datasetId);
    if (ds) {
      rows = ds.rows.map((r) => ({ labels: r.labels as Record<string, unknown>, decision: r.decision }));
    }
  }
  const metrics = rows.length > 0 ? evaluateDatasetRows(rows) : null;
  const promotion = await evaluatePromotionCandidate(modelId);
  return { modelId, metrics, promotion };
}
