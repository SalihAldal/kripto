import type { CanonicalScores, ConfidenceFusion, SourceSnapshots } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { FUSION_SOURCES } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { publishMarketIntelligence } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

export type ValidationResult = {
  passed: boolean;
  errors: string[];
  warnings: string[];
};

function validateSchema(scores: CanonicalScores): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(scores)) {
    if (typeof value !== "number" || Number.isNaN(value)) errors.push(`Invalid score: ${key}`);
    if (value < 0 || value > 100) errors.push(`Score out of range: ${key}=${value}`);
  }
  return errors;
}

function validateFreshness(sources: SourceSnapshots): string[] {
  const warnings: string[] = [];
  const unavailable = Object.entries(sources).filter(([, v]) => v && "unavailable" in v).map(([k]) => k);
  if (unavailable.length > 5) warnings.push(`High source unavailability: ${unavailable.join(", ")}`);
  return warnings;
}

function validateCompleteness(sources: SourceSnapshots): string[] {
  const errors: string[] = [];
  const available = Object.values(sources).filter((s) => s && !("unavailable" in s)).length;
  if (available < 3) errors.push(`Insufficient source coverage: ${available}/${FUSION_SOURCES.length}`);
  return errors;
}

function validateConfidence(confidence: ConfidenceFusion): string[] {
  const errors: string[] = [];
  if (confidence.overallConfidence < 25) errors.push("Overall confidence below minimum threshold");
  return errors;
}

export function validateIntelligenceObject(
  scores: CanonicalScores,
  sources: SourceSnapshots,
  confidence: ConfidenceFusion,
  conflictCount: number,
): ValidationResult {
  const errors = [
    ...validateSchema(scores),
    ...validateCompleteness(sources),
    ...validateConfidence(confidence),
  ];
  const warnings = [
    ...validateFreshness(sources),
    ...(conflictCount > 3 ? [`High conflict count: ${conflictCount}`] : []),
  ];
  return { passed: errors.length === 0, errors, warnings };
}

export async function validateAndPublish(fusionId?: string) {
  const fusion = fusionId
    ? await prisma.intelligenceFusion.findUnique({
        where: { id: fusionId },
        include: { marketIntelligence: true, marketContext: true, conflictMatrix: true },
      })
    : await prisma.intelligenceFusion.findFirst({
        orderBy: { startedAt: "desc" },
        include: { marketIntelligence: true, marketContext: true, conflictMatrix: true },
      });

  if (!fusion?.marketIntelligence || !fusion.marketContext) {
    return { published: false, reason: "Missing intelligence or context" };
  }

  const intel = fusion.marketIntelligence;
  if (intel.validationStatus === "PUBLISHED") {
    return { published: true, alreadyPublished: true, intelligenceId: intel.id };
  }

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

  const confidence = (intel.metadata ?? {
    overallConfidence: intel.confidenceScore,
    dataConfidence: 50,
    sourceConfidence: 50,
    historicalConfidence: 50,
    consensusConfidence: 50,
    predictionConfidence: 50,
  }) as unknown as ConfidenceFusion;

  const validation = validateIntelligenceObject(
    scores,
    sources,
    confidence,
    fusion.conflictMatrix?.conflictCount ?? 0,
  );

  if (!validation.passed) {
    await prisma.marketIntelligence.update({
      where: { id: intel.id },
      data: { validationStatus: "FAILED", metadata: { ...confidence, validationErrors: validation.errors } as never },
    });
    emitFusionEvent(FUSION_EVENT.VALIDATION_FAILED, { intelligenceId: intel.id, errors: validation.errors });
    return { published: false, validation };
  }

  await prisma.marketIntelligence.update({
    where: { id: intel.id },
    data: { validationStatus: "PASSED" },
  });

  const published = await publishMarketIntelligence(intel.id);
  emitFusionEvent(FUSION_EVENT.VALIDATION_PASSED, { intelligenceId: intel.id });
  emitFusionEvent(FUSION_EVENT.INTELLIGENCE_PUBLISHED, { intelligenceId: intel.id, intelligenceKey: published.intelligenceKey });
  return { published: true, intelligence: published, validation };
}
