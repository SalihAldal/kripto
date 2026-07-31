import type { CanonicalScores, SourceSnapshots } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { FUSION_SOURCES } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { persistFusionQuality } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

function computeCompleteness(sources: SourceSnapshots): number {
  const available = Object.values(sources).filter((s) => s && !("unavailable" in s)).length;
  return (available / FUSION_SOURCES.length) * 100;
}

function computeFreshness(sources: SourceSnapshots): number {
  let fresh = 0;
  let total = 0;
  for (const s of Object.values(sources)) {
    total++;
    if (s && !("unavailable" in s)) fresh++;
  }
  return total > 0 ? (fresh / total) * 100 : 0;
}

function computeConsistency(scores: CanonicalScores): number {
  const values = [scores.newsScore, scores.whaleScore, scores.onChainScore, scores.momentumScore, scores.trendScore];
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  return Math.max(0, 100 - Math.sqrt(variance) * 2);
}

export async function scoreFusionQuality(fusionId: string, scores: CanonicalScores, sources: SourceSnapshots, conflictCount = 0) {
  const completeness = computeCompleteness(sources);
  const freshness = computeFreshness(sources);
  const consistency = computeConsistency(scores);
  const conflictLevel = Math.min(100, conflictCount * 15);
  const confidence = scores.confidenceScore;
  const coverage = completeness;
  const qualityScore = Number(
    ((completeness + freshness + consistency + (100 - conflictLevel) + confidence + coverage) / 6).toFixed(1),
  );

  const quality = await persistFusionQuality(fusionId, {
    completeness: Number(completeness.toFixed(1)),
    freshness: Number(freshness.toFixed(1)),
    consistency: Number(consistency.toFixed(1)),
    conflictLevel,
    confidence,
    coverage: Number(coverage.toFixed(1)),
    qualityScore,
  });

  emitFusionEvent(FUSION_EVENT.QUALITY_SCORED, { fusionId, qualityScore });
  return quality;
}

export async function scoreQualityForFusion(fusionId?: string) {
  const fusion = fusionId
    ? await prisma.intelligenceFusion.findUnique({
        where: { id: fusionId },
        include: { marketIntelligence: true, marketContext: true, conflictMatrix: true },
      })
    : await prisma.intelligenceFusion.findFirst({
        orderBy: { startedAt: "desc" },
        include: { marketIntelligence: true, marketContext: true, conflictMatrix: true },
      });

  if (!fusion?.marketIntelligence || !fusion.marketContext) return { scored: false };

  const intel = fusion.marketIntelligence;
  const scores: CanonicalScores = {
    marketScore: intel.marketScore,
    trendScore: intel.trendScore,
    momentumScore: intel.momentumScore,
    volumeScore: intel.volumeScore,
    liquidityScore: intel.liquidityScore,
    orderBookScore: intel.orderBookScore,
    newsScore: intel.newsScore,
    whaleScore: intel.whaleScore,
    onChainScore: intel.onChainScore,
    portfolioScore: intel.portfolioScore,
    riskScore: intel.riskScore,
    learningScore: intel.learningScore,
    researchScore: intel.researchScore,
    macroScore: intel.macroScore,
    regimeScore: intel.regimeScore,
    volatilityScore: intel.volatilityScore,
    confidenceScore: intel.confidenceScore,
  };

  const sources = {
    marketSnapshot: (fusion.marketContext.marketSnapshot ?? {}) as Record<string, unknown>,
    scanner: (fusion.marketContext.scannerData ?? {}) as Record<string, unknown>,
    news: (fusion.marketContext.newsData ?? {}) as Record<string, unknown>,
    whale: (fusion.marketContext.whaleData ?? {}) as Record<string, unknown>,
    onChain: (fusion.marketContext.onChainData ?? {}) as Record<string, unknown>,
    portfolio: (fusion.marketContext.portfolioData ?? {}) as Record<string, unknown>,
    learning: (fusion.marketContext.learningData ?? {}) as Record<string, unknown>,
    research: (fusion.marketContext.researchData ?? {}) as Record<string, unknown>,
    risk: (fusion.marketContext.riskData ?? {}) as Record<string, unknown>,
    metaAi: (fusion.marketContext.metaAiData ?? {}) as Record<string, unknown>,
    governance: (fusion.marketContext.governanceData ?? {}) as Record<string, unknown>,
  };

  const existing = await prisma.fusionQuality.findUnique({ where: { fusionId: fusion.id } });
  if (existing) return { scored: true, existing: true, quality: existing };

  const quality = await scoreFusionQuality(
    fusion.id,
    scores,
    sources,
    fusion.conflictMatrix?.conflictCount ?? 0,
  );
  return { scored: true, quality };
}
