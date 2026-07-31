import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma, MLModelAlgorithm, MLValidationMethod, MLDecisionLabel } from "@prisma/client";
import type {
  DecisionEngineV2Prediction,
  InferenceArtifact,
  ModelTrainingResult,
} from "@/src/server/decision-engine-v2/decision-engine-v2.types";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function getModelRegistry() {
  return prisma.mLDecisionRegistry.upsert({
    where: { registryKey: "CURRENT" },
    create: { registryKey: "CURRENT" },
    update: {},
    include: {
      championModel: true,
      challengerModel: true,
      activeModel: true,
      previousModel: true,
      rollbackModel: true,
    },
  });
}

export async function getActiveModel() {
  const registry = await getModelRegistry();
  if (registry.activeModel) return registry.activeModel;
  return prisma.mLModel.findFirst({
    where: { status: { in: ["CHAMPION", "VALIDATED", "CHALLENGER"] } },
    orderBy: { trainingDate: "desc" },
  });
}

export async function createMLModel(input: {
  version: string;
  algorithm: MLModelAlgorithm;
  featureSetVersion: string;
  trainingDatasetId?: string;
  gitCommit?: string;
  artifactPath?: string;
  artifactJson?: InferenceArtifact;
  metadata?: Record<string, unknown>;
}) {
  return prisma.mLModel.create({
    data: {
      modelKey: key("ml"),
      version: input.version,
      algorithm: input.algorithm,
      status: "TRAINING",
      featureSetVersion: input.featureSetVersion,
      trainingDatasetId: input.trainingDatasetId,
      gitCommit: input.gitCommit,
      artifactPath: input.artifactPath,
      artifactJson: input.artifactJson as Prisma.InputJsonValue,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function updateMLModelStatus(modelId: string, status: Prisma.MLModelUpdateInput["status"]) {
  return prisma.mLModel.update({ where: { id: modelId }, data: { status: status as never } });
}

export async function persistModelTrainingResult(result: ModelTrainingResult) {
  const model = await prisma.mLModel.update({
    where: { id: result.modelId },
    data: {
      status: "VALIDATED",
      artifactJson: result.artifact as Prisma.InputJsonValue,
      metadata: { validationCount: result.validationMetrics.length } as Prisma.InputJsonValue,
    },
  });

  if (result.validationMetrics.length > 0) {
    await prisma.modelMetrics.createMany({
      data: result.validationMetrics.map((row) => ({
        metricsKey: key("mm"),
        modelId: result.modelId,
        validationMethod: row.method,
        accuracy: row.accuracy,
        f1Score: row.f1Score,
        sampleSize: row.sampleSize,
        metrics: row.metrics as Prisma.InputJsonValue,
      })),
    });
  }

  if (result.featureImportance.length > 0) {
    await prisma.mLFeatureImportance.createMany({
      data: result.featureImportance.map((row) => ({
        importanceKey: key("fi"),
        modelId: result.modelId,
        featureName: row.featureName,
        shapValue: row.shapValue,
        gainImportance: row.gainImportance,
        permutationImportance: row.permutationImportance,
      })),
    });
  }

  const registry = await getModelRegistry();
  if (!registry.championModelId) {
    await prisma.mLDecisionRegistry.update({
      where: { registryKey: "CURRENT" },
      data: { challengerModelId: model.id },
    });
  } else if (!registry.challengerModelId) {
    await prisma.mLDecisionRegistry.update({
      where: { registryKey: "CURRENT" },
      data: { challengerModelId: model.id },
    });
  }

  return model;
}

export async function persistModelPrediction(
  prediction: DecisionEngineV2Prediction,
  decisionId?: string,
) {
  return prisma.modelPrediction.create({
    data: {
      predictionKey: key("pred"),
      modelId: prediction.modelId,
      modelVersion: prediction.modelVersion,
      decisionId,
      symbol: String(prediction.featuresUsed ? (prediction as { symbol?: string }).symbol ?? "UNKNOWN" : "UNKNOWN"),
      featuresUsed: prediction.featuresUsed as Prisma.InputJsonValue,
      rawProbabilities: prediction.rawProbabilities as Prisma.InputJsonValue,
      calibratedProbabilities: prediction.calibratedProbabilities as Prisma.InputJsonValue,
      decision: prediction.decision,
      confidence: prediction.confidence,
      expectedReturn: prediction.expectedReturn,
      expectedRisk: prediction.expectedRisk,
      expectedHoldingMinutes: prediction.expectedHoldingMinutes,
      expectedMaxDrawdown: prediction.expectedMaxDrawdown,
      expectedMaxProfit: prediction.expectedMaxProfit,
      inferenceTimeMs: prediction.inferenceTimeMs,
      reason: prediction.reason,
      metadata: { source: "decision-engine-v2" } as Prisma.InputJsonValue,
    },
  });
}

export async function persistModelPredictionForSymbol(
  symbol: string,
  prediction: DecisionEngineV2Prediction,
  decisionId?: string,
) {
  return prisma.modelPrediction.create({
    data: {
      predictionKey: key("pred"),
      modelId: prediction.modelId,
      modelVersion: prediction.modelVersion,
      decisionId,
      symbol: symbol.toUpperCase(),
      featuresUsed: prediction.featuresUsed as Prisma.InputJsonValue,
      rawProbabilities: prediction.rawProbabilities as Prisma.InputJsonValue,
      calibratedProbabilities: prediction.calibratedProbabilities as Prisma.InputJsonValue,
      decision: prediction.decision,
      confidence: prediction.confidence,
      expectedReturn: prediction.expectedReturn,
      expectedRisk: prediction.expectedRisk,
      expectedHoldingMinutes: prediction.expectedHoldingMinutes,
      expectedMaxDrawdown: prediction.expectedMaxDrawdown,
      expectedMaxProfit: prediction.expectedMaxProfit,
      inferenceTimeMs: prediction.inferenceTimeMs,
      reason: prediction.reason,
    },
  });
}

export async function listModelPredictions(limit = 50) {
  return prisma.modelPrediction.findMany({ orderBy: { predictedAt: "desc" }, take: limit });
}

export async function listMLModels(limit = 20) {
  return prisma.mLModel.findMany({ orderBy: { trainingDate: "desc" }, take: limit });
}

export async function getLatestModelMetrics(modelId: string) {
  return prisma.modelMetrics.findMany({
    where: { modelId },
    orderBy: { validatedAt: "desc" },
  });
}

export async function getFeatureImportance(modelId: string) {
  return prisma.mLFeatureImportance.findMany({
    where: { modelId },
    orderBy: { gainImportance: "desc" },
  });
}

export async function persistShadowTrade(input: {
  decisionId: string;
  engineId: string;
  modelId?: string;
  symbol: string;
  decision: string;
  entryPrice?: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.shadowTrade.create({
    data: {
      tradeKey: key("st"),
      decisionId: input.decisionId,
      engineId: input.engineId,
      modelId: input.modelId,
      symbol: input.symbol.toUpperCase(),
      decision: input.decision,
      entryPrice: input.entryPrice,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function closeShadowTrade(tradeKey: string, exitPrice: number, virtualPnlPct: number) {
  const virtualPnl = virtualPnlPct;
  return prisma.shadowTrade.update({
    where: { tradeKey },
    data: {
      exitPrice,
      virtualPnl,
      virtualPnlPct,
      status: "CLOSED",
      closedAt: new Date(),
    },
  });
}

export async function persistShadowPerformance(input: {
  engineId: string;
  modelId?: string;
  periodStart: Date;
  periodEnd: Date;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  sharpe: number;
  maxDrawdown: number;
  missedTrades: number;
  rejectedTrades: number;
  expectedProfit: number;
  actualProfit: number;
  sampleSize: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.shadowPerformance.create({
    data: {
      perfKey: key("sp"),
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getLatestShadowPerformance(engineId?: string) {
  return prisma.shadowPerformance.findFirst({
    where: engineId ? { engineId } : undefined,
    orderBy: { calculatedAt: "desc" },
  });
}

export async function persistModelPromotion(input: {
  modelId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "ROLLED_BACK";
  shadowTradeCount: number;
  profitFactor?: number;
  expectancy?: number;
  maxDrawdown?: number;
  winRate?: number;
  blockers?: string[];
  rationale?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.modelPromotion.create({
    data: {
      promotionKey: key("mp"),
      modelId: input.modelId,
      status: input.status,
      shadowTradeCount: input.shadowTradeCount,
      profitFactor: input.profitFactor,
      expectancy: input.expectancy,
      maxDrawdown: input.maxDrawdown,
      winRate: input.winRate,
      blockers: input.blockers as Prisma.InputJsonValue,
      rationale: input.rationale,
      promotedAt: input.status === "APPROVED" ? new Date() : undefined,
      rolledBackAt: input.status === "ROLLED_BACK" ? new Date() : undefined,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getLatestModelPromotion(modelId?: string) {
  return prisma.modelPromotion.findFirst({
    where: modelId ? { modelId } : undefined,
    orderBy: { evaluatedAt: "desc" },
  });
}

export async function promoteModelToChampion(modelId: string) {
  const registry = await getModelRegistry();
  return prisma.$transaction(async (tx) => {
    if (registry.activeModelId) {
      await tx.mLModel.update({
        where: { id: registry.activeModelId },
        data: { status: "ARCHIVED" },
      });
    }
    await tx.mLModel.update({ where: { id: modelId }, data: { status: "CHAMPION" } });
    return tx.mLDecisionRegistry.update({
      where: { registryKey: "CURRENT" },
      data: {
        previousModelId: registry.activeModelId,
        activeModelId: modelId,
        championModelId: modelId,
        rollbackModelId: registry.activeModelId ?? registry.rollbackModelId,
      },
    });
  });
}

export async function rollbackActiveModel() {
  const registry = await getModelRegistry();
  if (!registry.rollbackModelId) return null;
  const rollbackId = registry.rollbackModelId;
  return prisma.$transaction(async (tx) => {
    if (registry.activeModelId) {
      await tx.mLModel.update({
        where: { id: registry.activeModelId },
        data: { status: "ROLLED_BACK" },
      });
    }
    await tx.mLModel.update({ where: { id: rollbackId }, data: { status: "CHAMPION" } });
    return tx.mLDecisionRegistry.update({
      where: { registryKey: "CURRENT" },
      data: {
        previousModelId: registry.activeModelId,
        activeModelId: rollbackId,
        championModelId: rollbackId,
      },
    });
  });
}

export async function exportTrainingRows(limit = 5000) {
  const rows = await prisma.decisionLog.findMany({
    where: { featureSnapshot: { isNot: null } },
    include: {
      featureSnapshot: true,
      replays: {
        where: { status: "COMPLETED" },
        include: { evaluation: { select: { peakProfitPct: true, mfePct: true, maePct: true } } },
        orderBy: { completedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });
  return rows;
}

export async function countClosedShadowTrades(engineId: string, modelId?: string) {
  return prisma.shadowTrade.count({
    where: {
      engineId,
      status: "CLOSED",
      ...(modelId ? { modelId } : {}),
    },
  });
}

export async function listClosedShadowTrades(engineId: string, limit = 500) {
  return prisma.shadowTrade.findMany({
    where: { engineId, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: limit,
  });
}

export async function persistValidationMetrics(
  modelId: string,
  method: MLValidationMethod,
  metrics: {
    accuracy: number;
    f1Score: number;
    sampleSize: number;
    hitRate?: number;
    profitFactor?: number;
    sharpe?: number;
    maxDrawdown?: number;
    extra?: Record<string, number>;
  },
) {
  return prisma.modelMetrics.create({
    data: {
      metricsKey: key("mm"),
      modelId,
      validationMethod: method,
      accuracy: metrics.accuracy,
      f1Score: metrics.f1Score,
      sampleSize: metrics.sampleSize,
      hitRate: metrics.hitRate,
      profitFactor: metrics.profitFactor,
      sharpe: metrics.sharpe,
      maxDrawdown: metrics.maxDrawdown,
      metrics: metrics.extra as Prisma.InputJsonValue,
    },
  });
}

export function parseArtifactJson(value: unknown): InferenceArtifact | null {
  if (!value || typeof value !== "object") return null;
  return value as InferenceArtifact;
}

export async function listDiscoveryHistory(limit = 30) {
  return listModelPredictions(limit);
}

export async function getPredictionDistribution(modelId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.modelPrediction.groupBy({
    by: ["decision"],
    where: { modelId, predictedAt: { gte: since } },
    _count: { decision: true },
  });
  return rows;
}
