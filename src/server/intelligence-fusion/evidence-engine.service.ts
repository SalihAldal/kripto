import type { CanonicalScores, EvidenceItem, SourceSnapshots } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import type { IntelligenceSourceType } from "@prisma/client";
import { persistEvidenceBatch } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

const SCORE_SOURCE_MAP: Record<keyof CanonicalScores, IntelligenceSourceType> = {
  marketScore: "MARKET_SNAPSHOT",
  trendScore: "MARKET_SNAPSHOT",
  momentumScore: "SCANNER",
  volumeScore: "MARKET_SNAPSHOT",
  liquidityScore: "MARKET_SNAPSHOT",
  orderBookScore: "MARKET_SNAPSHOT",
  newsScore: "NEWS",
  whaleScore: "WHALE",
  onChainScore: "ONCHAIN",
  portfolioScore: "PORTFOLIO",
  riskScore: "RISK",
  learningScore: "LEARNING",
  researchScore: "RESEARCH",
  macroScore: "NEWS",
  regimeScore: "MARKET_SNAPSHOT",
  volatilityScore: "MARKET_SNAPSHOT",
  confidenceScore: "META_AI",
};

async function getSourceReliability(source: IntelligenceSourceType): Promise<number> {
  const row = await prisma.sourceConfidence.findUnique({ where: { sourceType: source } });
  return row?.trustScore ?? 50;
}

function extractEvidenceForScore(
  scoreName: keyof CanonicalScores,
  value: number,
  sources: SourceSnapshots,
  reliability: number,
): EvidenceItem {
  const source = SCORE_SOURCE_MAP[scoreName];
  const sourceData = {
    MARKET_SNAPSHOT: sources.marketSnapshot,
    SCANNER: sources.scanner,
    NEWS: sources.news,
    WHALE: sources.whale,
    ONCHAIN: sources.onChain,
    PORTFOLIO: sources.portfolio,
    LEARNING: sources.learning,
    RESEARCH: sources.research,
    RISK: sources.risk,
    META_AI: sources.metaAi,
    GOVERNANCE: sources.governance,
  }[source];

  return {
    scoreName,
    source,
    value,
    supportingEvidence: {
      source,
      snapshot: sourceData,
      computedAt: new Date().toISOString(),
    },
    freshness: sourceData && !("unavailable" in sourceData) ? 85 : 30,
    historicalAccuracy: reliability,
    reliability,
  };
}

export async function collectEvidence(fusionId: string, scores: CanonicalScores, sources: SourceSnapshots) {
  const items: EvidenceItem[] = [];
  for (const [scoreName, value] of Object.entries(scores) as Array<[keyof CanonicalScores, number]>) {
    const source = SCORE_SOURCE_MAP[scoreName];
    const reliability = await getSourceReliability(source);
    items.push(extractEvidenceForScore(scoreName, value, sources, reliability));
  }
  await persistEvidenceBatch(fusionId, items);
  emitFusionEvent(FUSION_EVENT.EVIDENCE_COLLECTED, { fusionId, count: items.length });
  return items;
}

export async function collectEvidenceForFusion(fusionId?: string) {
  const fusion = fusionId
    ? await prisma.intelligenceFusion.findUnique({ where: { id: fusionId }, include: { marketIntelligence: true, marketContext: true } })
    : await prisma.intelligenceFusion.findFirst({
        orderBy: { startedAt: "desc" },
        include: { marketIntelligence: true, marketContext: true },
      });

  if (!fusion?.marketIntelligence || !fusion.marketContext) {
    return { collected: false };
  }

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

  const items = await collectEvidence(fusion.id, scores, sources);
  return { collected: true, fusionId: fusion.id, items };
}
