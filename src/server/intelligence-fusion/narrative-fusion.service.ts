import type { CanonicalScores } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { persistNarrativeContext } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

function buildStorySegments(scores: CanonicalScores) {
  const segments: Array<{ label: string; detail: string; score: number }> = [];

  if (scores.trendScore > 65) segments.push({ label: "BTC Leading", detail: "Primary trend strength elevated", score: scores.trendScore });
  if (scores.whaleScore > 60) segments.push({ label: "Whale Activity", detail: scores.whaleScore > 70 ? "Whales accumulating" : "Whale flow active", score: scores.whaleScore });
  if (scores.onChainScore > 60) segments.push({ label: "On-Chain Health", detail: "Protocol metrics supportive", score: scores.onChainScore });
  if (scores.newsScore > 65) segments.push({ label: "News Sentiment", detail: "Headline flow bullish", score: scores.newsScore });
  if (scores.newsScore < 40) segments.push({ label: "News Headwinds", detail: "Negative headline pressure", score: scores.newsScore });
  if (scores.momentumScore > 65) segments.push({ label: "Momentum Increasing", detail: "Price acceleration detected", score: scores.momentumScore });
  if (scores.liquidityScore > 60) segments.push({ label: "Liquidity Stable", detail: "Order book depth adequate", score: scores.liquidityScore });
  if (scores.riskScore < 45) segments.push({ label: "Risk Elevated", detail: "Portfolio/risk constraints active", score: scores.riskScore });
  if (scores.volatilityScore > 70) segments.push({ label: "High Volatility", detail: "Elevated vol environment", score: scores.volatilityScore });

  return segments;
}

function composeStory(segments: Array<{ label: string; detail: string }>): string {
  if (segments.length === 0) return "Market in equilibrium — no dominant narrative detected.";
  return segments.map((s) => `${s.label}: ${s.detail}`).join(". ") + ".";
}

export async function buildFusionNarrative(fusionId?: string) {
  const fusion = fusionId
    ? await prisma.intelligenceFusion.findUnique({ where: { id: fusionId }, include: { marketIntelligence: true } })
    : await prisma.intelligenceFusion.findFirst({
        orderBy: { startedAt: "desc" },
        include: { marketIntelligence: true },
      });

  if (!fusion?.marketIntelligence) return { built: false };

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

  const segments = buildStorySegments(scores);
  const story = composeStory(segments);
  const title = scores.marketScore > 65 ? "Risk-On Expansion" : scores.marketScore < 40 ? "Risk-Off Contraction" : "Mixed Market Regime";
  const heatScore = Math.min(100, segments.length * 12 + scores.marketScore * 0.3);
  const confidence = scores.confidenceScore;

  const narrative = await persistNarrativeContext(fusion.id, {
    title,
    story,
    segments,
    heatScore: Number(heatScore.toFixed(1)),
    confidence,
  });

  emitFusionEvent(FUSION_EVENT.NARRATIVE_BUILT, { fusionId: fusion.id, narrativeId: narrative.id });
  return { built: true, narrative, segments };
}
