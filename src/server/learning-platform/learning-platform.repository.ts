import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma, TrainingDatasetStatus, ModelCandidateStatus, ModelCandidateRole } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function createTrainingDataset(input: {
  datasetId: string;
  featureVersion: string;
  schemaVersion: string;
  labelVersion: string;
  trainingWindowStart?: Date;
  trainingWindowEnd?: Date;
  metadata?: Record<string, unknown>;
}) {
  return prisma.trainingDataset.create({
    data: {
      datasetKey: key("tds"),
      datasetId: input.datasetId,
      featureVersion: input.featureVersion,
      schemaVersion: input.schemaVersion,
      labelVersion: input.labelVersion,
      trainingWindowStart: input.trainingWindowStart,
      trainingWindowEnd: input.trainingWindowEnd,
      metadata: input.metadata as Prisma.InputJsonValue,
      status: "BUILDING",
    },
  });
}

export async function updateTrainingDatasetCounts(
  id: string,
  input: { rowCount: number; validRowCount: number; rejectedRowCount: number; status: TrainingDatasetStatus },
) {
  return prisma.trainingDataset.update({
    where: { id },
    data: input,
  });
}

export async function persistLabeledRow(input: {
  trainingDatasetId: string;
  decisionId: string;
  symbol: string;
  decision: string;
  featureSnapshot: Record<string, unknown>;
  labels: Record<string, unknown>;
  executionMetrics?: Record<string, unknown>;
  replayMetrics?: Record<string, unknown>;
  entryMetrics?: Record<string, unknown>;
  exitMetrics?: Record<string, unknown>;
  marketRegime?: string;
  coinCategory?: string;
  pnlPct?: number;
  holdingTimeMinutes?: number;
  slippagePct?: number;
  feePct?: number;
  validationStatus: string;
  rejectionReason?: string;
  decisionTimestamp: Date;
}) {
  return prisma.labeledDatasetRow.upsert({
    where: {
      trainingDatasetId_decisionId: {
        trainingDatasetId: input.trainingDatasetId,
        decisionId: input.decisionId,
      },
    },
    create: {
      rowKey: key("ldr"),
      ...input,
      featureSnapshot: input.featureSnapshot as Prisma.InputJsonValue,
      labels: input.labels as Prisma.InputJsonValue,
      executionMetrics: input.executionMetrics as Prisma.InputJsonValue,
      replayMetrics: input.replayMetrics as Prisma.InputJsonValue,
      entryMetrics: input.entryMetrics as Prisma.InputJsonValue,
      exitMetrics: input.exitMetrics as Prisma.InputJsonValue,
    },
    update: {
      labels: input.labels as Prisma.InputJsonValue,
      validationStatus: input.validationStatus,
      rejectionReason: input.rejectionReason,
      replayMetrics: input.replayMetrics as Prisma.InputJsonValue,
      executionMetrics: input.executionMetrics as Prisma.InputJsonValue,
    },
  });
}

export async function listTrainingDatasets(limit = 20) {
  return prisma.trainingDataset.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

export async function getTrainingDatasetByDatasetId(datasetId: string) {
  return prisma.trainingDataset.findUnique({
    where: { datasetId },
    include: { rows: { where: { validationStatus: "VALID" }, take: 10_000 } },
  });
}

export async function listValidDatasetRows(trainingDatasetId: string, limit = 10_000) {
  return prisma.labeledDatasetRow.findMany({
    where: { trainingDatasetId, validationStatus: "VALID" },
    orderBy: { decisionTimestamp: "asc" },
    take: limit,
  });
}

export async function upsertCoinProfile(input: {
  symbol: string;
  avgWinRate: number;
  avgProfitPct: number;
  avgLossPct: number;
  bestHoldingMinutes?: number;
  worstHoldingMinutes?: number;
  bestEntryHour?: number;
  worstEntryHour?: number;
  bestMarketRegime?: string;
  worstMarketRegime?: string;
  avgVolatility?: number;
  avgSpread?: number;
  preferredStrategy?: string;
  historicalConfidence?: number;
  tradeCount: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.coinProfile.upsert({
    where: { symbol: input.symbol.toUpperCase() },
    create: {
      profileKey: key("cp"),
      ...input,
      symbol: input.symbol.toUpperCase(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
    update: {
      ...input,
      symbol: input.symbol.toUpperCase(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function upsertMarketMemory(input: {
  regimeType: string;
  similarityVector?: Record<string, unknown>;
  occurrenceCount: number;
  avgReturnPct?: number;
  winRate?: number;
  avgVolatility?: number;
  metadata?: Record<string, unknown>;
}) {
  const regimeKey = input.regimeType.toUpperCase();
  const existing = await prisma.marketMemory.findFirst({ where: { regimeType: regimeKey } });
  if (existing) {
    return prisma.marketMemory.update({
      where: { id: existing.id },
      data: {
        occurrenceCount: input.occurrenceCount,
        avgReturnPct: input.avgReturnPct,
        winRate: input.winRate,
        avgVolatility: input.avgVolatility,
        similarityVector: input.similarityVector as Prisma.InputJsonValue,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }
  return prisma.marketMemory.create({
    data: {
      memoryKey: key("mm"),
      regimeType: regimeKey,
      occurrenceCount: input.occurrenceCount,
      avgReturnPct: input.avgReturnPct,
      winRate: input.winRate,
      avgVolatility: input.avgVolatility,
      similarityVector: input.similarityVector as Prisma.InputJsonValue,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistTradeMemory(input: {
  tradeId?: string;
  decisionId?: string;
  symbol: string;
  whyWin?: string;
  whyLoss?: string;
  couldEnterEarlier?: boolean;
  couldExitLater?: boolean;
  strategyCorrect?: boolean;
  regimeCorrect?: boolean;
  structuredExplanation?: Record<string, unknown>;
  pnlPct?: number;
  holdingMinutes?: number;
  metadata?: Record<string, unknown>;
}) {
  if (input.tradeId) {
    const existing = await prisma.tradeMemory.findFirst({ where: { tradeId: input.tradeId } });
    if (existing) return existing;
  }
  return prisma.tradeMemory.create({
    data: {
      memoryKey: key("tm"),
      ...input,
      symbol: input.symbol.toUpperCase(),
      structuredExplanation: input.structuredExplanation as Prisma.InputJsonValue,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistLearningInsight(input: {
  category: string;
  title: string;
  content: string;
  severity?: string;
  symbol?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.learningInsight.create({
    data: {
      insightKey: key("li"),
      category: input.category,
      title: input.title,
      content: input.content,
      severity: input.severity ?? "INFO",
      symbol: input.symbol?.toUpperCase(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function createModelCandidate(input: {
  modelId: string;
  trainingDatasetId?: string;
  role?: ModelCandidateRole;
  status?: ModelCandidateStatus;
  shadowTradeCount?: number;
  profitFactor?: number;
  expectancy?: number;
  maxDrawdown?: number;
  winRate?: number;
  sharpe?: number;
  sortino?: number;
  auc?: number;
  promotionBlockers?: string[];
  meetsCriteria?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return prisma.modelCandidate.create({
    data: {
      candidateKey: key("mc"),
      modelId: input.modelId,
      trainingDatasetId: input.trainingDatasetId,
      role: input.role ?? "EXPERIMENTAL",
      status: input.status ?? "PENDING",
      shadowTradeCount: input.shadowTradeCount ?? 0,
      profitFactor: input.profitFactor,
      expectancy: input.expectancy,
      maxDrawdown: input.maxDrawdown,
      winRate: input.winRate,
      sharpe: input.sharpe,
      sortino: input.sortino,
      auc: input.auc,
      promotionBlockers: input.promotionBlockers ?? [],
      meetsCriteria: input.meetsCriteria ?? false,
      evaluatedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistLearningReport(input: {
  reportType: string;
  reportDate: Date;
  strengths?: unknown;
  weaknesses?: unknown;
  worstDecisions?: unknown;
  bestDecisions?: unknown;
  topCoins?: unknown;
  worstCoins?: unknown;
  bestHours?: unknown;
  worstHours?: unknown;
  improvements?: unknown;
  summary?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.learningReport.create({
    data: {
      reportKey: key("lr"),
      reportType: input.reportType,
      reportDate: input.reportDate,
      strengths: input.strengths as Prisma.InputJsonValue,
      weaknesses: input.weaknesses as Prisma.InputJsonValue,
      worstDecisions: input.worstDecisions as Prisma.InputJsonValue,
      bestDecisions: input.bestDecisions as Prisma.InputJsonValue,
      topCoins: input.topCoins as Prisma.InputJsonValue,
      worstCoins: input.worstCoins as Prisma.InputJsonValue,
      bestHours: input.bestHours as Prisma.InputJsonValue,
      worstHours: input.worstHours as Prisma.InputJsonValue,
      improvements: input.improvements as Prisma.InputJsonValue,
      summary: input.summary,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function listModelCandidates(limit = 20) {
  return prisma.modelCandidate.findMany({
    include: { model: true, trainingDataset: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listCoinProfiles(limit = 50) {
  return prisma.coinProfile.findMany({ orderBy: { tradeCount: "desc" }, take: limit });
}

export async function listMarketMemories(limit = 20) {
  return prisma.marketMemory.findMany({ orderBy: { occurrenceCount: "desc" }, take: limit });
}

export async function listTradeMemories(limit = 50) {
  return prisma.tradeMemory.findMany({ orderBy: { recordedAt: "desc" }, take: limit });
}

export async function listLearningReports(limit = 30) {
  return prisma.learningReport.findMany({ orderBy: { reportDate: "desc" }, take: limit });
}

export async function getLearningPlatformDashboard() {
  const [datasets, candidates, coinProfiles, marketMemories, tradeMemories, reports, insights] = await Promise.all([
    listTrainingDatasets(10),
    listModelCandidates(10),
    listCoinProfiles(20),
    listMarketMemories(10),
    listTradeMemories(20),
    listLearningReports(10),
    prisma.learningInsight.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return { datasets, candidates, coinProfiles, marketMemories, tradeMemories, reports, insights };
}
