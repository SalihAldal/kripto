import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { EntryFilterReason, EntryVerdict, SpotEntryType, WaitDuration } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function persistEntryAnalysis(data: Record<string, unknown>) {
  return prisma.entryAnalysis.create({ data: { analysisKey: key("ean"), ...data } as never });
}

export async function updateEntryAnalysis(analysisId: string, data: Record<string, unknown>) {
  return prisma.entryAnalysis.update({ where: { id: analysisId }, data: data as never });
}

export async function persistEntryReplay(data: Record<string, unknown>) {
  return prisma.entryReplay.create({ data: { replayKey: key("erp"), ...data } as never });
}

export async function persistEntryQuality(data: Record<string, unknown>) {
  return prisma.entryQuality.create({ data: { qualityKey: key("eqt"), ...data } as never });
}

export async function upsertEntryPattern(input: {
  patternType: SpotEntryType;
  symbol?: string;
  hourOfDay?: number;
  regime?: string;
  structure?: string;
  successRate: number;
  avgProfitPct: number;
  avgQualityScore: number;
  isWorst?: boolean;
}) {
  const patternKey = key("pat");
  return prisma.entryPattern.create({
    data: {
      patternKey,
      occurrenceCount: 1,
      ...input,
    },
  });
}

export async function persistEntryRecommendation(input: {
  analysisId: string;
  symbol: string;
  verdict: EntryVerdict;
  entryType?: SpotEntryType;
  qualityScore: number;
  confidence: number;
  summary: string;
  reasons: string[];
  waitUntil?: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  return prisma.entryRecommendation.create({
    data: {
      recommendationKey: key("rec"),
      ...input,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getEntryDashboard() {
  const [analyses, replays, qualities, patterns, recommendations] = await Promise.all([
    prisma.entryAnalysis.findMany({ orderBy: { analyzedAt: "desc" }, take: 50 }),
    prisma.entryReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 30 }),
    prisma.entryQuality.findMany({ orderBy: { scoredAt: "desc" }, take: 30 }),
    prisma.entryPattern.findMany({ orderBy: { successRate: "desc" }, take: 20 }),
    prisma.entryRecommendation.findMany({ orderBy: { recommendedAt: "desc" }, take: 30, include: { analysis: true } }),
  ]);

  const bestEntries = qualities.filter((q) => q.qualityScore >= 75).slice(0, 10);
  const worstEntries = qualities.filter((q) => q.qualityScore < 40).slice(0, 10);
  const bestPatterns = patterns.filter((p) => !p.isWorst).slice(0, 10);
  const worstPatterns = patterns.filter((p) => p.isWorst).slice(0, 10);

  const buyCount = analyses.filter((a) => a.verdict === "BUY").length;
  const accuracy = replays.length > 0 ? (replays.filter((r) => r.wasOptimal).length / replays.length) * 100 : 0;

  return {
    analyses,
    replays,
    qualities,
    patterns,
    recommendations,
    bestEntries,
    worstEntries,
    bestPatterns,
    worstPatterns,
    stats: { totalAnalyses: analyses.length, buyCount, entryAccuracy: Number(accuracy.toFixed(1)) },
  };
}

export async function getPendingReevaluations() {
  return prisma.entryAnalysis.findMany({
    where: { verdict: "WAIT", reevaluateAt: { lte: new Date() } },
    orderBy: { reevaluateAt: "asc" },
    take: 20,
  });
}

export async function buildEntryHeatmap() {
  const patterns = await prisma.entryPattern.findMany({ take: 500 });
  const byHour: Record<number, { count: number; success: number; quality: number }> = {};
  for (const p of patterns) {
    if (p.hourOfDay == null) continue;
    const row = byHour[p.hourOfDay] ?? { count: 0, success: 0, quality: 0 };
    row.count += p.occurrenceCount;
    row.success += p.successRate * p.occurrenceCount;
    row.quality += p.avgQualityScore * p.occurrenceCount;
    byHour[p.hourOfDay] = row;
  }
  return Object.entries(byHour).map(([hour, data]) => ({
    hour: Number(hour),
    avgSuccess: data.count > 0 ? data.success / data.count : 0,
    avgQuality: data.count > 0 ? data.quality / data.count : 0,
    count: data.count,
  }));
}

export async function listEntryAnalyses(symbol?: string, limit = 30) {
  return prisma.entryAnalysis.findMany({
    where: symbol ? { symbol: symbol.toUpperCase() } : undefined,
    orderBy: { analyzedAt: "desc" },
    take: limit,
    include: { qualities: true, recommendations: true, replays: true },
  });
}
