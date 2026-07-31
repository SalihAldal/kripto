import type { ConflictEntry, CanonicalScores } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import type { ConflictSeverity } from "@prisma/client";
import {
  getFusionById,
  persistConflictMatrix,
} from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

type Stance = "BULLISH" | "BEARISH" | "NEUTRAL";

function stanceFromScore(score: number, bullishThreshold = 60, bearishThreshold = 40): Stance {
  if (score >= bullishThreshold) return "BULLISH";
  if (score <= bearishThreshold) return "BEARISH";
  return "NEUTRAL";
}

function detectConflicts(scores: CanonicalScores): ConflictEntry[] {
  const conflicts: ConflictEntry[] = [];
  const pairs: Array<[string, number, string, number]> = [
    ["news", scores.newsScore, "whale", scores.whaleScore],
    ["momentum", scores.momentumScore, "risk", scores.riskScore],
    ["news", scores.newsScore, "onChain", scores.onChainScore],
    ["whale", scores.whaleScore, "portfolio", scores.portfolioScore],
    ["trend", scores.trendScore, "volatility", scores.volatilityScore],
  ];

  for (const [srcA, scoreA, srcB, scoreB] of pairs) {
    const stanceA = stanceFromScore(scoreA);
    const stanceB = stanceFromScore(scoreB);
    if (stanceA !== stanceB && stanceA !== "NEUTRAL" && stanceB !== "NEUTRAL") {
      const delta = Math.abs(scoreA - scoreB);
      const severity: ConflictSeverity = delta > 40 ? "CRITICAL" : delta > 25 ? "HIGH" : delta > 15 ? "MEDIUM" : "LOW";
      conflicts.push({
        sourceA: srcA,
        sourceB: srcB,
        signalA: `${stanceA} (${scoreA})`,
        signalB: `${stanceB} (${scoreB})`,
        severity,
      });
    }
  }

  if (scores.riskScore < 40 && scores.momentumScore > 65) {
    conflicts.push({
      sourceA: "momentum",
      sourceB: "portfolio/risk",
      signalA: `BULLISH (${scores.momentumScore})`,
      signalB: `RISK HIGH (${scores.riskScore})`,
      severity: "HIGH",
    });
  }

  return conflicts;
}

function interpretConflicts(conflicts: ConflictEntry[], scores: CanonicalScores): string {
  if (conflicts.length === 0) return "All intelligence sources align — high consensus environment.";
  const critical = conflicts.filter((c) => c.severity === "CRITICAL" || c.severity === "HIGH");
  if (critical.some((c) => c.sourceA === "news" && c.sourceB === "whale")) {
    return "News-whale divergence detected — treat headline sentiment with caution; whale flow takes precedence for positioning.";
  }
  if (critical.some((c) => c.sourceB.includes("risk"))) {
    return "Momentum bullish but risk/portfolio constraints elevated — reduce size, wait for alignment.";
  }
  if (scores.confidenceScore > 65) return "Minor conflicts present but overall confidence supports current bias.";
  return "Mixed signals — defer aggressive action until source convergence improves.";
}

function overallSeverity(conflicts: ConflictEntry[]): ConflictSeverity {
  if (conflicts.length === 0) return "NONE";
  const order: Record<ConflictSeverity, number> = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
  return conflicts.reduce((m, c) => (order[c.severity] > order[m] ? c.severity : m), "NONE" as ConflictSeverity);
}

export async function resolveFusionConflicts(fusionId?: string) {
  const fusion = fusionId
    ? await getFusionById(fusionId)
    : await prisma.intelligenceFusion.findFirst({
        orderBy: { startedAt: "desc" },
        include: { marketIntelligence: true },
      });

  if (!fusion?.marketIntelligence) return { resolved: false, reason: "No fusion intelligence found" };

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

  const conflicts = detectConflicts(scores);
  const severity = overallSeverity(conflicts);
  const recommendedInterpretation = interpretConflicts(conflicts, scores);

  const existing = await prisma.conflictMatrix.findUnique({ where: { fusionId: fusion.id } });
  if (existing) {
    return { resolved: true, existing: true, conflicts, severity, recommendedInterpretation };
  }

  const matrix = await persistConflictMatrix(
    fusion.id,
    conflicts as unknown as Record<string, unknown>[],
    severity,
    recommendedInterpretation,
    conflicts.length,
  );

  emitFusionEvent(FUSION_EVENT.CONFLICT_DETECTED, { fusionId: fusion.id, conflictCount: conflicts.length, severity });
  emitFusionEvent(FUSION_EVENT.CONFLICT_RESOLVED, { fusionId: fusion.id, matrixId: matrix.id });
  return { resolved: true, matrix, conflicts, severity, recommendedInterpretation };
}
