import { buildLabeledDataset } from "@/src/server/learning-platform/dataset-builder.service";
import { validateDataset } from "@/src/server/learning-platform/dataset-validation.service";
import { runTrainingPipeline, evaluateTrainedModel } from "@/src/server/learning-platform/training-pipeline.service";
import { evaluatePromotionCandidate, listPromotionCandidates } from "@/src/server/learning-platform/promotion-candidate.service";
import { learnCoinIntelligence } from "@/src/server/learning-platform/coin-learning.service";
import { learnMarketMemory } from "@/src/server/learning-platform/market-memory.service";
import { learnTradeMemory } from "@/src/server/learning-platform/trade-memory.service";
import { evaluateMissedOpportunitiesForLearning } from "@/src/server/learning-platform/missed-opportunity.service";
import { generateDailyLearningReport } from "@/src/server/learning-platform/daily-learning-report.service";
import { getLearningPlatformDashboard, getTrainingDatasetByDatasetId } from "@/src/server/learning-platform/learning-platform.repository";
import { syncInferenceCacheFromRegistry } from "@/src/server/decision-engine-v2/model-registry.service";
import type { LearningPlatformJobPayload } from "@/src/server/learning-platform/learning-platform.types";

export async function runLearningPlatformJob(payload: LearningPlatformJobPayload) {
  switch (payload.type) {
    case "DATASET_BUILD":
      return buildLabeledDataset({ limit: payload.limit, datasetId: payload.datasetId });
    case "DATASET_VALIDATE": {
      if (payload.datasetId) {
        const ds = await getTrainingDatasetByDatasetId(payload.datasetId);
        if (!ds) throw new Error(`Dataset not found: ${payload.datasetId}`);
        return validateDataset(ds.id);
      }
      throw new Error("datasetId required for DATASET_VALIDATE");
    }
    case "TRAIN_MODEL":
      return runTrainingPipeline({
        algorithm: payload.algorithm,
        datasetId: payload.datasetId,
        limit: payload.limit,
      });
    case "EVALUATE_MODEL":
      return payload.modelId
        ? evaluateTrainedModel(payload.modelId, payload.datasetId)
        : listPromotionCandidates();
    case "REGISTRY_SYNC":
      await syncInferenceCacheFromRegistry();
      return { synced: true };
    case "COIN_LEARN":
      return learnCoinIntelligence({ symbol: payload.symbol, limit: payload.limit });
    case "MARKET_MEMORY":
      return learnMarketMemory(payload.limit);
    case "TRADE_MEMORY":
      return learnTradeMemory({ tradeId: payload.tradeId, limit: payload.limit });
    case "MISSED_OPPORTUNITY":
      return evaluateMissedOpportunitiesForLearning(payload.limit);
    case "DAILY_REPORT":
      return generateDailyLearningReport(payload.date ? new Date(payload.date) : new Date());
    case "PROMOTION_CANDIDATE":
      return payload.modelId ? evaluatePromotionCandidate(payload.modelId) : listPromotionCandidates();
    default:
      return { skipped: true };
  }
}

export async function getLearningPlatformDashboardData() {
  const dashboard = await getLearningPlatformDashboard();
  const candidates = await listPromotionCandidates(10);
  return { ...dashboard, promotionCandidates: candidates };
}
