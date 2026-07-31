import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type {
  CanonicalScores,
  ConfidenceFusion,
  EvidenceItem,
  SourceSnapshots,
} from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import type { ConflictSeverity, FusionAssetClass, FusionValidationStatus, IntelligenceSourceType } from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function createFusionRun(input: { assetClass?: FusionAssetClass; symbol?: string }) {
  return prisma.intelligenceFusion.create({
    data: {
      fusionKey: key("fus"),
      assetClass: input.assetClass ?? "CRYPTO",
      symbol: input.symbol,
      status: "RUNNING",
    },
  });
}

export async function completeFusionRun(fusionId: string, sourceCount: number) {
  return prisma.intelligenceFusion.update({
    where: { id: fusionId },
    data: { status: "COMPLETED", sourceCount, completedAt: new Date() },
  });
}

export async function persistFusedMarketContext(fusionId: string, sources: SourceSnapshots, assetClass?: FusionAssetClass, symbol?: string) {
  return prisma.fusedMarketContext.create({
    data: {
      contextKey: key("ctx"),
      fusionId,
      assetClass: assetClass ?? "CRYPTO",
      symbol,
      marketSnapshot: sources.marketSnapshot as Prisma.InputJsonValue,
      scannerData: sources.scanner as Prisma.InputJsonValue,
      newsData: sources.news as Prisma.InputJsonValue,
      whaleData: sources.whale as Prisma.InputJsonValue,
      onChainData: sources.onChain as Prisma.InputJsonValue,
      portfolioData: sources.portfolio as Prisma.InputJsonValue,
      learningData: sources.learning as Prisma.InputJsonValue,
      researchData: sources.research as Prisma.InputJsonValue,
      riskData: sources.risk as Prisma.InputJsonValue,
      metaAiData: sources.metaAi as Prisma.InputJsonValue,
      governanceData: sources.governance as Prisma.InputJsonValue,
    },
  });
}

export async function persistMarketIntelligence(
  fusionId: string,
  scores: CanonicalScores,
  input: { assetClass?: FusionAssetClass; symbol?: string; validationStatus?: FusionValidationStatus; confidence?: ConfidenceFusion },
) {
  return prisma.marketIntelligence.create({
    data: {
      intelligenceKey: key("intel"),
      fusionId,
      assetClass: input.assetClass ?? "CRYPTO",
      symbol: input.symbol,
      ...scores,
      validationStatus: input.validationStatus ?? "PENDING",
      metadata: input.confidence ? (input.confidence as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}

export async function publishMarketIntelligence(intelligenceId: string) {
  return prisma.marketIntelligence.update({
    where: { id: intelligenceId },
    data: { validationStatus: "PUBLISHED", publishedAt: new Date() },
  });
}

export async function persistConflictMatrix(
  fusionId: string,
  matrix: Record<string, unknown>[],
  severity: ConflictSeverity,
  recommendedInterpretation: string,
  conflictCount: number,
) {
  return prisma.conflictMatrix.create({
    data: {
      fusionId,
      matrix: matrix as Prisma.InputJsonValue,
      severity,
      recommendedInterpretation,
      conflictCount,
    },
  });
}

export async function upsertSourceConfidence(sourceType: IntelligenceSourceType, trustScore: number, historicalAccuracy: number, sampleCount: number) {
  return prisma.sourceConfidence.upsert({
    where: { sourceType },
    create: { sourceType, trustScore, historicalAccuracy, sampleCount },
    update: { trustScore, historicalAccuracy, sampleCount: { increment: 1 } },
  });
}

export async function persistEvidenceBatch(fusionId: string, items: EvidenceItem[]) {
  return prisma.evidenceStore.createMany({
    data: items.map((item) => ({
      evidenceKey: key("ev"),
      fusionId,
      scoreName: item.scoreName,
      source: item.source,
      value: item.value,
      supportingEvidence: item.supportingEvidence as Prisma.InputJsonValue,
      freshness: item.freshness,
      historicalAccuracy: item.historicalAccuracy,
      reliability: item.reliability,
    })),
  });
}

export async function persistFusionQuality(
  fusionId: string,
  quality: { completeness: number; freshness: number; consistency: number; conflictLevel: number; confidence: number; coverage: number; qualityScore: number },
) {
  return prisma.fusionQuality.create({ data: { fusionId, ...quality } });
}

export async function persistNarrativeContext(
  fusionId: string,
  input: { title: string; story: string; segments?: Record<string, unknown>[]; heatScore: number; confidence: number },
) {
  return prisma.narrativeContext.create({
    data: {
      narrativeKey: key("nar"),
      fusionId,
      title: input.title,
      story: input.story,
      segments: input.segments as Prisma.InputJsonValue,
      heatScore: input.heatScore,
      confidence: input.confidence,
    },
  });
}

export async function persistFusionTimeline(intelligenceId: string, scores: CanonicalScores, contextHash?: string) {
  return prisma.fusionTimeline.create({
    data: {
      timelineKey: key("tl"),
      intelligenceId,
      scores: scores as unknown as Prisma.InputJsonValue,
      contextHash,
    },
  });
}

export async function updateKnowledgeGraph(fusionId: string, graph: Record<string, unknown>) {
  return prisma.fusedMarketContext.update({
    where: { fusionId },
    data: { knowledgeGraph: graph as Prisma.InputJsonValue },
  });
}

export async function getLatestMarketIntelligence() {
  return prisma.marketIntelligence.findFirst({
    where: { validationStatus: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    include: {
      fusion: {
        include: {
          marketContext: true,
          conflictMatrix: true,
          fusionQuality: true,
          evidence: { take: 50 },
          narratives: { where: { active: true }, take: 5 },
        },
      },
      timeline: { take: 1, orderBy: { snapshotAt: "desc" } },
    },
  });
}

export async function getFusionDashboard() {
  const [latest, sourceConfidences, recentFusions, narratives, conflicts, timeline, quality] = await Promise.all([
    getLatestMarketIntelligence(),
    prisma.sourceConfidence.findMany({ orderBy: { trustScore: "desc" } }),
    prisma.intelligenceFusion.findMany({ orderBy: { startedAt: "desc" }, take: 10, include: { marketIntelligence: true, fusionQuality: true } }),
    prisma.narrativeContext.findMany({ where: { active: true }, orderBy: { heatScore: "desc" }, take: 10 }),
    prisma.conflictMatrix.findMany({ orderBy: { resolvedAt: "desc" }, take: 10 }),
    prisma.fusionTimeline.findMany({ orderBy: { snapshotAt: "desc" }, take: 20 }),
    prisma.fusionQuality.findMany({ orderBy: { scoredAt: "desc" }, take: 10 }),
  ]);
  return { latest, sourceConfidences, recentFusions, narratives, conflicts, timeline, quality };
}

export async function listHistoricalIntelligence(limit = 50) {
  return prisma.marketIntelligence.findMany({
    where: { validationStatus: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: { fusion: { include: { fusionQuality: true } } },
  });
}

export async function listEvidence(fusionId?: string, limit = 100) {
  return prisma.evidenceStore.findMany({
    where: fusionId ? { fusionId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function listConflicts(limit = 20) {
  return prisma.conflictMatrix.findMany({ orderBy: { resolvedAt: "desc" }, take: limit, include: { fusion: true } });
}

export async function listNarratives(limit = 15) {
  return prisma.narrativeContext.findMany({ where: { active: true }, orderBy: { heatScore: "desc" }, take: limit });
}

export async function getSourceReliability() {
  return prisma.sourceConfidence.findMany({ orderBy: { trustScore: "desc" } });
}

export async function getFusionById(fusionId: string) {
  return prisma.intelligenceFusion.findUnique({
    where: { id: fusionId },
    include: {
      marketIntelligence: true,
      marketContext: true,
      conflictMatrix: true,
      fusionQuality: true,
      evidence: true,
      narratives: true,
    },
  });
}

export async function getTimelineEntry(timelineKey: string) {
  return prisma.fusionTimeline.findUnique({
    where: { timelineKey },
    include: { intelligence: { include: { fusion: { include: { marketContext: true } } } } },
  });
}
