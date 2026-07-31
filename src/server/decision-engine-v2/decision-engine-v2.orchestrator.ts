import { trainDecisionEngineV2Model } from "@/src/server/decision-engine-v2/model-training.service";
import { predictBatchForRecentDecisions } from "@/src/server/decision-engine-v2/prediction.service";
import { syncInferenceCacheFromRegistry, getModelRegistryDashboard } from "@/src/server/decision-engine-v2/model-registry.service";
import {
  calculateShadowPerformanceReport,
  compareRuleVsMlShadow,
  evaluateShadowTradesForEngine,
  ML_ENGINE_ID,
} from "@/src/server/decision-engine-v2/shadow-integration.service";
import { evaluateModelPromotion, rollbackModelIfUnstable, getPromotionStatus } from "@/src/server/decision-engine-v2/promotion.service";
import {
  listModelPredictions,
  listMLModels,
  getFeatureImportance,
  getPredictionDistribution,
  getActiveModel,
} from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import type { DecisionEngineV2JobPayload } from "@/src/server/decision-engine-v2/decision-engine-v2.types";

export async function runDecisionEngineV2Job(payload: DecisionEngineV2JobPayload) {
  switch (payload.type) {
    case "PREDICTION_BATCH":
      return predictBatchForRecentDecisions(payload.limit ?? 20);
    case "MODEL_TRAIN":
      return trainDecisionEngineV2Model({ algorithm: payload.algorithm, limit: payload.limit });
    case "MODEL_VALIDATE":
      return syncInferenceCacheFromRegistry();
    case "CALIBRATION_UPDATE":
      return syncInferenceCacheFromRegistry();
    case "FEATURE_IMPORTANCE": {
      const model = await getActiveModel();
      if (!model) return { message: "No active model" };
      return getFeatureImportance(model.id);
    }
    case "SHADOW_PERFORMANCE":
      return calculateShadowPerformanceReport({
        engineId: payload.engineId ?? ML_ENGINE_ID,
        days: payload.days ?? 30,
      });
    case "PROMOTION_CHECK":
      await evaluateShadowTradesForEngine(ML_ENGINE_ID, 40);
      await rollbackModelIfUnstable();
      return evaluateModelPromotion(payload.modelId);
    case "REGISTRY_SYNC":
      return syncInferenceCacheFromRegistry();
    default:
      return { skipped: true };
  }
}

export async function getDecisionEngineV2Dashboard() {
  const active = await getActiveModel();
  const [registry, predictions, models, promotion, comparison, distribution] = await Promise.all([
    getModelRegistryDashboard(),
    listModelPredictions(30),
    listMLModels(10),
    getPromotionStatus(active?.id),
    compareRuleVsMlShadow(30),
    active ? getPredictionDistribution(active.id, 30) : Promise.resolve([]),
  ]);
  const importance = active ? await getFeatureImportance(active.id) : [];
  return {
    registry,
    activeModel: active,
    predictions,
    models,
    promotion,
    comparison,
    distribution,
    featureImportance: importance,
  };
}
