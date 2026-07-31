import { prisma } from "@/src/server/db/prisma";
import { persistRecommendation } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { emitPerfOptEvent, PERF_OPT_EVENT } from "@/src/server/performance-optimizer/performance-optimizer.events";
import type { PerfOptRecommendationTarget } from "@prisma/client";

type RecInput = {
  target: PerfOptRecommendationTarget;
  title: string;
  description: string;
  expectedBenefit: string;
  confidence: number;
  evidence: Record<string, unknown>;
  historicalSuccess?: number;
};

export async function generateAiRecommendations() {
  const [latestReview, missed, lateEntries, earlyExits, qualities] = await Promise.all([
    prisma.perfOptPerformanceReview.findFirst({ orderBy: { reviewDate: "desc" } }),
    prisma.perfOptMissedOpportunity.findMany({ orderBy: { missedProfitPct: "desc" }, take: 10 }),
    prisma.perfOptEntryOptimization.findMany({ orderBy: { lostOpportunityPct: "desc" }, take: 10 }),
    prisma.perfOptExitOptimization.findMany({ where: { optimizationType: "EARLY_EXIT" }, orderBy: { lostProfitPct: "desc" }, take: 10 }),
    prisma.perfOptTradeQuality.findMany({ orderBy: { scoredAt: "desc" }, take: 50 }),
  ]);

  const recs: RecInput[] = [];
  const avgQuality = qualities.length > 0 ? qualities.reduce((s, q) => s + q.overallScore, 0) / qualities.length : 50;

  if (latestReview && latestReview.winRate < 45) {
    recs.push({
      target: "ENTRY_AI",
      title: "Increase momentum confirmation",
      description: "Win rate below 45% — require stronger momentum before entry",
      expectedBenefit: "Higher win rate, fewer low-quality entries",
      confidence: 72,
      evidence: { winRate: latestReview.winRate, tradeCount: latestReview.tradeCount },
      historicalSuccess: 65,
    });
  }

  if (missed.length > 3 && missed[0]!.missedProfitPct > 2) {
    recs.push({
      target: "SCANNER",
      title: "Review reject thresholds for high-momentum setups",
      description: `${missed.length} missed opportunities with avg ${(missed.reduce((s, m) => s + m.missedProfitPct, 0) / missed.length).toFixed(1)}% profit`,
      expectedBenefit: "Capture more valid scanner candidates",
      confidence: 68,
      evidence: { topMissed: missed.slice(0, 3).map((m) => ({ symbol: m.symbol, missed: m.missedProfitPct })) },
      historicalSuccess: 55,
    });
  }

  if (lateEntries.length > 2) {
    recs.push({
      target: "ENTRY_AI",
      title: "Wait for pullback before entry",
      description: "Multiple late entries detected — consider pullback confirmation",
      expectedBenefit: "Better entry prices, improved R:R",
      confidence: 70,
      evidence: { lateEntryCount: lateEntries.length },
      historicalSuccess: 60,
    });
  }

  if (earlyExits.length > 2) {
    recs.push({
      target: "EXIT_AI",
      title: "Improve exit timing — hold winners longer",
      description: "Early exits leaving profit on table",
      expectedBenefit: "Higher average profit per trade",
      confidence: 75,
      evidence: { earlyExitCount: earlyExits.length },
      historicalSuccess: 62,
    });
  }

  if (avgQuality < 50) {
    recs.push({
      target: "GENERAL",
      title: "Reduce weak volume entries",
      description: "Average trade quality below 50 — filter low-volume setups",
      expectedBenefit: "Fewer low quality trades, better capital preservation",
      confidence: 78,
      evidence: { avgQuality },
      historicalSuccess: 70,
    });
  }

  if (latestReview && latestReview.profitFactor < 1.2) {
    recs.push({
      target: "RISK_ENGINE",
      title: "Tighten risk on marginal setups",
      description: `Profit factor ${latestReview.profitFactor} — losses outweigh wins`,
      expectedBenefit: "Improved profit factor and drawdown control",
      confidence: 80,
      evidence: { profitFactor: latestReview.profitFactor },
      historicalSuccess: 72,
    });
  }

  const records = [];
  for (const r of recs) {
    const record = await persistRecommendation({
      target: r.target,
      title: r.title,
      description: r.description,
      expectedBenefit: r.expectedBenefit,
      confidence: r.confidence,
      supportingEvidence: r.evidence,
      historicalSuccess: r.historicalSuccess,
    });
    records.push(record);
    emitPerfOptEvent(PERF_OPT_EVENT.RECOMMENDATION_GENERATED, { recommendationKey: record.recommendationKey, target: r.target });
  }

  return { generated: records.length, recommendations: records };
}

export async function generateParameterRecommendations() {
  const aiRecs = await generateAiRecommendations();
  const paramRecs = aiRecs.recommendations.map((r) => ({
    ...r,
    note: "Recommendation only — NOT applied automatically",
    parameterHints: {
      SCANNER: { minScore: "+5", volumeFilter: "enable" },
      ENTRY_AI: { confidenceThreshold: "+5", waitForPullback: true },
      EXIT_AI: { holdExtensionMinutes: "+15" },
      STRATEGY_SELECTOR: { compatibilityMin: "+10" },
      RISK_ENGINE: { maxRiskPct: "-0.5" },
      LEARNING_ENGINE: { sampleWeightRecent: "+0.1" },
      GENERAL: { volumeFilter: "enable", confidenceThreshold: "+3" },
    }[r.target] ?? {},
  }));
  return { parameterRecommendations: paramRecs, applied: false };
}
