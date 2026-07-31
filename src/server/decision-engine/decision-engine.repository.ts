import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { MasterDecisionOutput } from "@/src/server/decision-engine/decision-engine.types";

export async function persistMasterDecision(output: MasterDecisionOutput) {
  await prisma.expertOpinion.createMany({
    data: output.expertOpinions.map((row) => ({
      decisionId: output.decisionId,
      symbol: output.symbol,
      expertType: row.expertType,
      opinion: row.opinion,
      confidence: row.confidence,
      score: row.score,
      summary: row.summary,
      positiveFactors: row.positiveFactors,
      negativeFactors: row.negativeFactors,
      topRisks: row.topRisks,
      metadata: row.metadata as Prisma.InputJsonValue,
    })),
  });

  await prisma.decisionMatrix.create({
    data: {
      decisionId: output.decisionId,
      symbol: output.symbol,
      marketScore: output.matrix.market,
      momentumScore: output.matrix.momentum,
      volumeScore: output.matrix.volume,
      liquidityScore: output.matrix.liquidity,
      riskScore: output.matrix.risk,
      newsScore: output.matrix.news,
      executionScore: output.matrix.execution,
      learningScore: output.matrix.learning,
      matrix: output.matrix as Prisma.InputJsonValue,
    },
  });

  await prisma.consensusDecision.create({
    data: {
      decisionId: output.decisionId,
      symbol: output.symbol,
      decision: output.decision,
      legacyDecision: output.legacyDecision,
      consensusScore: output.consensusScore,
      conflictScore: output.conflictScore,
      agreementScore: output.agreementScore,
      stability: output.stability,
      confidence: output.confidence,
      reliability: output.reliability,
      metadata: { watchlist: output.watchlist },
    },
  });

  await prisma.decisionConflict.create({
    data: {
      decisionId: output.decisionId,
      symbol: output.symbol,
      severity: output.conflicts[0]?.severity ?? 0,
      conflicts: output.conflicts as Prisma.InputJsonValue,
      report: { count: output.conflicts.length, top: output.conflicts.slice(0, 5) } as Prisma.InputJsonValue,
    },
  });

  await prisma.decisionConsensus.create({
    data: {
      decisionId: output.decisionId,
      symbol: output.symbol,
      payload: {
        matrix: output.matrix,
        metrics: {
          consensusScore: output.consensusScore,
          conflictScore: output.conflictScore,
          agreementScore: output.agreementScore,
          stability: output.stability,
          confidence: output.confidence,
          reliability: output.reliability,
        },
      } as Prisma.InputJsonValue,
    },
  });

  await prisma.decisionExplanation.create({
    data: {
      decisionId: output.decisionId,
      symbol: output.symbol,
      humanReadable: output.humanReadable,
      attribution: output.attribution as Prisma.InputJsonValue,
      supporters: output.attribution.supporters as Prisma.InputJsonValue,
      blockers: output.attribution.blockers as Prisma.InputJsonValue,
      confidenceReducers: output.attribution.confidenceReducers as Prisma.InputJsonValue,
    },
  });
}

export async function getDecisionMatrix(decisionId: string) {
  return prisma.decisionMatrix.findUnique({ where: { decisionId } });
}

export async function listExpertOpinions(decisionId: string) {
  return prisma.expertOpinion.findMany({ where: { decisionId }, orderBy: { score: "desc" } });
}

export async function getConsensusDecision(decisionId: string) {
  return prisma.consensusDecision.findUnique({ where: { decisionId } });
}

export async function getConflictReport(decisionId: string) {
  return prisma.decisionConflict.findUnique({ where: { decisionId } });
}

export async function getDecisionExplanation(decisionId: string) {
  return prisma.decisionExplanation.findUnique({ where: { decisionId } });
}

export async function listDecisionTimeline(limit = 100) {
  return prisma.consensusDecision.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listActiveWatchlist(limit = 100) {
  return prisma.decisionWatchlist.findMany({
    where: { status: "ACTIVE" },
    orderBy: { nextRecheckAt: "asc" },
    take: limit,
  });
}

export async function listExpertPerformance(expertType?: string, limit = 50) {
  return prisma.expertPerformance.findMany({
    where: expertType ? { expertType: expertType as never } : undefined,
    orderBy: { computedAt: "desc" },
    take: limit,
  });
}

export async function listExpertRecommendations(limit = 20) {
  return prisma.expertRecommendation.findMany({
    orderBy: { computedAt: "desc" },
    take: limit,
  });
}

export async function getLatestConsensusBySymbol(symbol: string) {
  return prisma.consensusDecision.findFirst({
    where: { symbol: symbol.toUpperCase() },
    orderBy: { createdAt: "desc" },
  });
}
