import { prisma } from "@/src/server/db/prisma";
import type { Prisma, ValidationReportCadence } from "@prisma/client";
import { getLatestPromotionStatus } from "@/src/server/shadow-validation/promotion-rules.service";
import type { ShadowDecisionCapture } from "@/src/server/shadow-validation/shadow-validation.types";

export async function persistShadowDecision(capture: ShadowDecisionCapture) {
  return prisma.shadowDecision.upsert({
    where: {
      decisionId_engineId: {
        decisionId: capture.decisionId,
        engineId: capture.engineId,
      },
    },
    create: {
      decisionId: capture.decisionId,
      symbol: capture.symbol.toUpperCase(),
      engineId: capture.engineId,
      engineMode: capture.engineMode,
      decision: capture.decision,
      confidence: capture.confidence,
      entryPrice: capture.entryPrice,
      targetPrice: capture.targetPrice,
      stopPrice: capture.stopPrice,
      reasoning: capture.reasoning,
      payload: capture.payload as Prisma.InputJsonValue,
      productionDecision: capture.productionDecision,
      isProduction: capture.isProduction ?? false,
    },
    update: {
      decision: capture.decision,
      confidence: capture.confidence,
      entryPrice: capture.entryPrice,
      targetPrice: capture.targetPrice,
      stopPrice: capture.stopPrice,
      reasoning: capture.reasoning,
      payload: capture.payload as Prisma.InputJsonValue,
      productionDecision: capture.productionDecision,
      isProduction: capture.isProduction ?? false,
      capturedAt: new Date(),
    },
  });
}

export async function persistDecisionDifference(input: {
  decisionId: string;
  symbol: string;
  productionEngineId: string;
  shadowEngineId: string;
  productionDecision: string;
  shadowDecision: string;
  confidenceDelta?: number;
  reasoningDelta?: string;
  disagreements?: string[];
  expertConflicts?: Array<{ expert: string; productionView: string; shadowView: string }>;
  profitDeltaPct?: number;
  winnerEngineId?: string;
}) {
  return prisma.decisionDifference.create({
    data: {
      decisionId: input.decisionId,
      symbol: input.symbol.toUpperCase(),
      productionEngineId: input.productionEngineId,
      shadowEngineId: input.shadowEngineId,
      productionDecision: input.productionDecision,
      shadowDecision: input.shadowDecision,
      confidenceDelta: input.confidenceDelta,
      reasoningDelta: input.reasoningDelta,
      disagreements: input.disagreements as Prisma.InputJsonValue,
      expertConflicts: input.expertConflicts as Prisma.InputJsonValue,
      profitDeltaPct: input.profitDeltaPct,
      winnerEngineId: input.winnerEngineId,
    },
  });
}

export async function updateShadowDecisionEvaluation(input: {
  decisionId: string;
  engineId: string;
  verdict: string;
  profitPct: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.shadowDecision.updateMany({
    where: { decisionId: input.decisionId, engineId: input.engineId },
    data: {
      verdict: input.verdict as never,
      profitPct: input.profitPct,
      evaluatedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function listShadowDecisions(input?: { limit?: number; engineId?: string; decisionId?: string }) {
  return prisma.shadowDecision.findMany({
    where: {
      engineId: input?.engineId,
      decisionId: input?.decisionId,
    },
    orderBy: { capturedAt: "desc" },
    take: input?.limit ?? 100,
  });
}

export async function listPendingShadowEvaluations(limit = 100) {
  return prisma.shadowDecision.findMany({
    where: { verdict: "PENDING", capturedAt: { lte: new Date(Date.now() - 60 * 60 * 1000) } },
    orderBy: { capturedAt: "asc" },
    take: limit,
  });
}

export async function listEngineRankings(cadence: ValidationReportCadence = "DAILY", limit = 20) {
  return prisma.enginePerformance.findMany({
    orderBy: [{ periodEnd: "desc" }, { profitFactor: "desc" }],
    where: { cadence },
    take: limit,
  });
}

export async function listDecisionDifferences(input?: { limit?: number; decisionId?: string }) {
  return prisma.decisionDifference.findMany({
    where: { decisionId: input?.decisionId },
    orderBy: { createdAt: "desc" },
    take: input?.limit ?? 100,
  });
}

export async function createValidationRun(input: {
  runType: string;
  periodStart?: Date;
  periodEnd?: Date;
  engineIds?: string[];
  metadata?: Record<string, unknown>;
}) {
  return prisma.validationRun.create({
    data: {
      runType: input.runType,
      status: "RUNNING",
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      engineIds: input.engineIds as Prisma.InputJsonValue,
      metadata: input.metadata as Prisma.InputJsonValue,
      startedAt: new Date(),
    },
  });
}

export async function completeValidationRun(id: string, summary: Record<string, unknown>) {
  return prisma.validationRun.update({
    where: { id },
    data: { status: "COMPLETED", summary: summary as Prisma.InputJsonValue, completedAt: new Date() },
  });
}

export async function persistEngineComparison(input: {
  periodStart: Date;
  periodEnd: Date;
  cadence: ValidationReportCadence;
  engineA: string;
  engineB: string;
  ranking: unknown;
  headToHead: unknown;
  profitDeltaPct?: number;
  riskDeltaPct?: number;
  winnerEngineId?: string;
}) {
  return prisma.engineComparison.create({ data: input as never });
}

export async function persistSimulationResult(input: {
  runId?: string;
  engineId: string;
  windowDays: number;
  periodStart: Date;
  periodEnd: Date;
  decisions: number;
  winRate?: number;
  profitFactor?: number;
  sharpeRatio?: number;
  maxDrawdownPct?: number;
  comparison?: unknown;
}) {
  return prisma.simulationResult.create({
    data: {
      runId: input.runId,
      engineId: input.engineId,
      windowDays: input.windowDays,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      decisions: input.decisions,
      winRate: input.winRate,
      profitFactor: input.profitFactor,
      sharpeRatio: input.sharpeRatio,
      maxDrawdownPct: input.maxDrawdownPct,
      comparison: input.comparison as Prisma.InputJsonValue,
    },
  });
}

export async function persistReplayComparison(input: {
  decisionId: string;
  symbol: string;
  engineId: string;
  replayDecision?: string;
  productionDecision?: string;
  verdict: string;
  profitDeltaPct?: number;
  mfePct?: number;
  maePct?: number;
}) {
  return prisma.replayComparison.create({ data: input as never });
}

export async function listSimulationResults(windowDays?: number, limit = 50) {
  return prisma.simulationResult.findMany({
    where: windowDays ? { windowDays } : undefined,
    orderBy: { computedAt: "desc" },
    take: limit,
  });
}

export async function getValidationDashboard() {
  const [rankings, promotions, latestRun, disagreements] = await Promise.all([
    listEngineRankings("DAILY", 10),
    getLatestPromotionStatus(),
    prisma.validationRun.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.decisionDifference.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  ]);
  return { rankings, promotions, latestRun, disagreements24h: disagreements };
}
