import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { ExitVerdict, SpotExitType } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function persistExitAnalysis(data: Record<string, unknown>) {
  return prisma.exitAnalysis.create({ data: { analysisKey: key("exa"), ...data } as never });
}

export async function persistProfitProtection(data: Record<string, unknown>) {
  return prisma.profitProtection.create({ data: { protectionKey: key("pp"), ...data } as never });
}

export async function persistExitReplay(data: Record<string, unknown>) {
  return prisma.exitReplay.create({ data: { replayKey: key("erp"), ...data } as never });
}

export async function persistExitQuality(data: Record<string, unknown>) {
  return prisma.exitQuality.create({ data: { qualityKey: key("eqt"), ...data } as never });
}

export async function persistExitRecommendation(input: {
  analysisId: string;
  positionId?: string;
  symbol: string;
  verdict: ExitVerdict;
  exitType?: SpotExitType;
  exitScore: number;
  confidence: number;
  summary: string;
  reasons: string[];
  holdUntil?: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  return prisma.exitRecommendation.create({
    data: {
      recommendationKey: key("rec"),
      sellPct: "PCT_100",
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistExitLearning(input: {
  exitType?: SpotExitType;
  symbol?: string;
  hourOfDay?: number;
  regime?: string;
  structure?: string;
  occurrenceCount: number;
  successRate: number;
  avgProfitPct: number;
  avgQualityScore: number;
  isWorst?: boolean;
}) {
  return prisma.exitLearning.create({
    data: { learningKey: key("lrn"), ...input },
  });
}

export async function getExitDashboard() {
  const [analyses, replays, qualities, recommendations, protections, learnings] = await Promise.all([
    prisma.exitAnalysis.findMany({ orderBy: { analyzedAt: "desc" }, take: 50 }),
    prisma.exitReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 30 }),
    prisma.exitQuality.findMany({ orderBy: { scoredAt: "desc" }, take: 30 }),
    prisma.exitRecommendation.findMany({ orderBy: { recommendedAt: "desc" }, take: 30, include: { analysis: true } }),
    prisma.profitProtection.findMany({ orderBy: { recordedAt: "desc" }, take: 30 }),
    prisma.exitLearning.findMany({ orderBy: { successRate: "desc" }, take: 20 }),
  ]);

  const bestExits = qualities.filter((q) => q.qualityScore >= 75).slice(0, 10);
  const worstExits = qualities.filter((q) => q.qualityScore < 40).slice(0, 10);
  const sellCount = analyses.filter((a) => a.verdict === "SELL").length;
  const accuracy = replays.length > 0 ? (replays.filter((r) => r.wasOptimal).length / replays.length) * 100 : 0;

  return {
    analyses, replays, qualities, recommendations, protections, learnings,
    bestExits, worstExits,
    stats: { totalAnalyses: analyses.length, sellCount, exitAccuracy: Number(accuracy.toFixed(1)) },
  };
}

export async function getPendingHoldReevaluations() {
  return prisma.exitAnalysis.findMany({
    where: { verdict: "HOLD", reevaluateAt: { lte: new Date() } },
    orderBy: { reevaluateAt: "asc" },
    take: 20,
  });
}

export async function listExitAnalyses(symbol?: string, limit = 30) {
  return prisma.exitAnalysis.findMany({
    where: symbol ? { symbol: symbol.toUpperCase() } : undefined,
    orderBy: { analyzedAt: "desc" },
    take: limit,
    include: { qualities: true, recommendations: true, replays: true, profitSnapshots: true },
  });
}

export async function getProfitProtectionTimeline(positionId?: string, limit = 50) {
  return prisma.profitProtection.findMany({
    where: positionId ? { positionId } : undefined,
    orderBy: { recordedAt: "desc" },
    take: limit,
  });
}
