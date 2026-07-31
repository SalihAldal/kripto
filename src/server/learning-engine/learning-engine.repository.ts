import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type {
  ConfidenceCalibrationPoint,
  DecisionLearningRecord,
  FeatureImportanceRow,
  PatternDiscoveryResult,
  RejectLearningVerdict,
  TradeLearningRecord,
  WeightSuggestionRow,
} from "@/src/server/learning-engine/learning-engine.types";

export async function createLearningSession(input: {
  sessionType: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.learningSession.create({
    data: {
      sessionType: input.sessionType,
      status: "RUNNING",
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function completeLearningSession(sessionId: string, metadata?: Record<string, unknown>) {
  return prisma.learningSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", completedAt: new Date(), metadata: metadata as Prisma.InputJsonValue },
  });
}

export async function persistDecisionMemory(input: DecisionLearningRecord) {
  return prisma.decisionMemory.create({
    data: {
      decisionId: input.decisionId,
      symbol: input.symbol.toUpperCase(),
      decision: input.decision,
      confidence: input.confidence,
      reasoning: input.reasoning,
      expertOpinions: input.expertOpinions as Prisma.InputJsonValue,
      scannerProfile: input.scannerProfile as Prisma.InputJsonValue,
      marketSnapshot: input.marketSnapshot as Prisma.InputJsonValue,
      outcome: input.outcome,
      learningSummary: input.learningSummary,
    },
  });
}

export async function persistTradeLearningMemory(input: TradeLearningRecord & { learningSummary?: string }) {
  return prisma.learningMemory.create({
    data: {
      memoryType: "TRADE",
      refId: input.tradeId,
      symbol: input.symbol.toUpperCase(),
      payload: input as unknown as Prisma.InputJsonValue,
      summary: input.learningSummary,
    },
  });
}

export async function upsertPatternLibrary(input: PatternDiscoveryResult & { metadata?: Record<string, unknown> }) {
  const existing = await prisma.patternLibrary.findFirst({ where: { patternKey: input.patternKey } });
  if (existing) {
    return prisma.patternLibrary.update({
      where: { id: existing.id },
      data: {
        winRate: input.winRate,
        sampleSize: input.sampleSize,
        expectancy: input.expectancy,
        regime: input.regime,
        hourBucket: input.hourBucket,
        weekday: input.weekday,
        status: input.status,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }
  return prisma.patternLibrary.create({
    data: {
      patternKey: input.patternKey,
      winRate: input.winRate,
      sampleSize: input.sampleSize,
      expectancy: input.expectancy,
      regime: input.regime,
      hourBucket: input.hourBucket,
      weekday: input.weekday,
      status: input.status,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistPatternPerformance(input: {
  patternKey: string;
  symbol?: string;
  winRate?: number;
  profitFactor?: number;
  sampleSize?: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.patternPerformance.create({
    data: {
      patternKey: input.patternKey,
      symbol: input.symbol?.toUpperCase(),
      winRate: input.winRate,
      profitFactor: input.profitFactor,
      sampleSize: input.sampleSize,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistKnowledgeEntry(input: {
  title: string;
  category: string;
  content: string;
  tags?: string[];
  patternKey?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.knowledgeBase.create({
    data: {
      title: input.title,
      category: input.category,
      content: input.content,
      tags: input.tags ?? [],
      patternKey: input.patternKey,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistWeightSuggestion(input: WeightSuggestionRow & { expiresAt?: Date }) {
  return prisma.weightSuggestion.create({
    data: {
      feature: input.feature,
      currentWeight: input.currentWeight,
      suggestedWeight: input.suggestedWeight,
      expectedWinRateDelta: input.expectedWinRateDelta,
      expectedProfitFactorDelta: input.expectedProfitFactorDelta,
      confidence: input.confidence,
      rationale: input.rationale,
      expiresAt: input.expiresAt,
    },
  });
}

export async function persistFeatureImportance(rows: FeatureImportanceRow[]) {
  if (rows.length === 0) return 0;
  await prisma.featureImportance.deleteMany({ where: { computedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60_000) } } });
  await prisma.featureImportance.createMany({
    data: rows.map((row) => ({
      feature: row.feature,
      importance: row.importance,
      direction: row.direction,
      sampleSize: row.sampleSize,
    })),
  });
  return rows.length;
}

export async function persistDailyAIReport(input: {
  reportDate: Date;
  content: Record<string, unknown>;
  summary?: string;
}) {
  return prisma.dailyAIReport.upsert({
    where: { reportDate: input.reportDate },
    create: {
      reportDate: input.reportDate,
      summary: input.summary,
      content: input.content as Prisma.InputJsonValue,
    },
    update: {
      summary: input.summary,
      content: input.content as Prisma.InputJsonValue,
    },
  });
}

export async function persistWeeklyResearch(input: {
  weekStart: Date;
  content: Record<string, unknown>;
  summary?: string;
}) {
  return prisma.weeklyResearch.upsert({
    where: { weekStart: input.weekStart },
    create: {
      weekStart: input.weekStart,
      summary: input.summary,
      content: input.content as Prisma.InputJsonValue,
    },
    update: {
      summary: input.summary,
      content: input.content as Prisma.InputJsonValue,
    },
  });
}

export async function persistRejectLearning(input: RejectLearningVerdict) {
  return prisma.learningMemory.create({
    data: {
      memoryType: "REJECT",
      refId: input.decisionId,
      symbol: "ALL",
      summary: input.verdict,
      payload: input as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function persistPatternReplay(input: {
  patternKey: string;
  decisionId?: string;
  tradeId?: string;
  replayData: Record<string, unknown>;
}) {
  return prisma.patternReplay.create({
    data: {
      patternKey: input.patternKey,
      decisionId: input.decisionId,
      tradeId: input.tradeId,
      replayData: input.replayData as Prisma.InputJsonValue,
    },
  });
}

export async function persistConfidenceCalibration(points: ConfidenceCalibrationPoint[]) {
  await prisma.confidenceCalibration.deleteMany({});
  if (points.length === 0) return 0;
  await prisma.confidenceCalibration.createMany({
    data: points.map((point) => ({
      predictedBin: point.predictedBin,
      predictedAvg: point.predictedAvg,
      actualSuccessRate: point.actualSuccessRate,
      sampleCount: point.count,
      calibrationError: point.calibrationError,
    })),
  });
  return points.length;
}

export async function getLearningDashboard() {
  const [sessions, patterns, knowledge, suggestions, reports, weekly, memories] = await Promise.all([
    prisma.learningSession.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    prisma.patternLibrary.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.knowledgeBase.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.weightSuggestion.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.dailyAIReport.findMany({ orderBy: { reportDate: "desc" }, take: 7 }),
    prisma.weeklyResearch.findMany({ orderBy: { weekStart: "desc" }, take: 4 }),
    prisma.learningMemory.count(),
  ]);
  return { sessions, patterns, knowledge, suggestions, reports, weekly, memoryCount: memories };
}

export async function searchKnowledge(query: string, limit = 30) {
  const q = query.trim().toLowerCase();
  const rows = await prisma.knowledgeBase.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return rows
    .filter(
      (row) =>
        row.title.toLowerCase().includes(q) ||
        row.content.toLowerCase().includes(q) ||
        row.tags.some((tag) => tag.toLowerCase().includes(q)),
    )
    .slice(0, limit);
}

export async function listFeatureImportance(limit = 50) {
  return prisma.featureImportance.findMany({ orderBy: { importance: "desc" }, take: limit });
}

export async function listWeightSuggestions(limit = 50) {
  return prisma.weightSuggestion.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: { confidence: "desc" },
    take: limit,
  });
}

export async function listConfidenceCalibration() {
  return prisma.confidenceCalibration.findMany({ orderBy: { predictedAvg: "asc" } });
}

export async function listPatternExplorer(limit = 100) {
  return prisma.patternLibrary.findMany({ orderBy: { expectancy: "desc" }, take: limit });
}
