import { prisma } from "@/src/server/db/prisma";
import { getLatestContext, persistExecutiveDecision } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { emitMetaEvent, META_EVENT } from "@/src/server/meta-intelligence/meta-intelligence.events";
import type { ConfidenceScores } from "@/src/server/meta-intelligence/meta-intelligence.types";

type ConflictSignal = { source: string; signal: string; stance: "BULLISH" | "BEARISH" | "NEUTRAL" | "BLOCK" };

export async function resolveConflicts(contextId?: string) {
  const ctx = contextId
    ? await prisma.metaContext.findUnique({ where: { id: contextId } })
    : await getLatestContext();
  if (!ctx) return { resolved: false };

  const signals: ConflictSignal[] = [];
  const news = ctx.newsSnapshot as { avgScore?: number } | null;
  const whale = ctx.whaleSnapshot as { avgActivity?: number } | null;
  const portfolio = ctx.portfolioSnapshot as { openPositions?: number } | null;
  const risk = ctx.riskSnapshot as { exposureLevel?: string } | null;

  if ((news?.avgScore ?? 50) > 65) signals.push({ source: "news", signal: "BULLISH", stance: "BULLISH" });
  else if ((news?.avgScore ?? 50) < 35) signals.push({ source: "news", signal: "BEARISH", stance: "BEARISH" });
  else signals.push({ source: "news", signal: "NEUTRAL", stance: "NEUTRAL" });

  if ((whale?.avgActivity ?? 50) > 70) signals.push({ source: "whale", signal: "DISTRIBUTION_RISK", stance: "BEARISH" });
  else if ((whale?.avgActivity ?? 50) > 50) signals.push({ source: "whale", signal: "ACCUMULATION", stance: "BULLISH" });
  else signals.push({ source: "whale", signal: "QUIET", stance: "NEUTRAL" });

  signals.push({ source: "scanner", signal: "MOMENTUM_BUY", stance: "BULLISH" });

  if (risk?.exposureLevel === "ELEVATED") signals.push({ source: "risk", signal: "WAIT", stance: "BLOCK" });
  else signals.push({ source: "risk", signal: "PROCEED", stance: "NEUTRAL" });

  if ((portfolio?.openPositions ?? 0) > 10) signals.push({ source: "portfolio", signal: "NO_CAPITAL", stance: "BLOCK" });

  const bullish = signals.filter((s) => s.stance === "BULLISH").length;
  const bearish = signals.filter((s) => s.stance === "BEARISH").length;
  const blocks = signals.filter((s) => s.stance === "BLOCK").length;

  let recommendation: string;
  let resolution: string;
  let priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

  if (blocks > 0) {
    recommendation = "HOLD — capital or risk constraints active";
    resolution = "Risk/portfolio constraints override bullish signals";
    priority = "HIGH";
  } else if (bullish > bearish + 1) {
    recommendation = "SELECTIVE_BUY — aligned bullish intelligence";
    resolution = "Majority intelligence sources align bullish with no blocking constraints";
    priority = "MEDIUM";
  } else if (bearish > bullish) {
    recommendation = "REDUCE_EXPOSURE — distribution signals detected";
    resolution = "Whale/news divergence suggests caution";
    priority = "HIGH";
  } else {
    recommendation = "WAIT — conflicting signals, insufficient conviction";
    resolution = "Mixed signals require more data convergence";
    priority = "MEDIUM";
  }

  const conflictSummary = signals.map((s) => `${s.source}: ${s.signal}`).join(" | ");
  const confidence: ConfidenceScores = {
    overallConfidence: Math.max(30, 70 - blocks * 15 - Math.abs(bullish - bearish) * 5),
    dataConfidence: ctx.dataConfidence,
    marketConfidence: Math.min(100, (news?.avgScore ?? 50)),
    executionConfidence: blocks > 0 ? 40 : 70,
    portfolioConfidence: (portfolio?.openPositions ?? 0) > 10 ? 35 : 75,
    modelConfidence: 65,
  };

  const decision = await persistExecutiveDecision({
    contextId: ctx.id,
    recommendation,
    conflictSummary,
    resolution,
    confidence,
    supportingEvidence: { signals, bullish, bearish, blocks },
    historicalSimilarity: 55,
    expectedBenefit: recommendation.includes("BUY") ? "Capture aligned momentum" : "Preserve capital",
    expectedRisk: recommendation.includes("REDUCE") ? "Missed upside if wrong" : "Opportunity cost of waiting",
    implementationCost: "Zero — recommendation only, no production changes",
    priority,
  });

  emitMetaEvent(META_EVENT.CONFLICT_RESOLVED, { decisionId: decision.id, recommendation });
  emitMetaEvent(META_EVENT.DECISION_MADE, { decisionId: decision.id });
  return { decision, signals, recommendation };
}
