import type { CanonicalScores, SourceSnapshots } from "@/src/server/intelligence-fusion/intelligence-fusion.types";

function avg(nums: number[]): number {
  if (nums.length === 0) return 50;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function scoreFromSnapshot(snap: Record<string, unknown>): Partial<CanonicalScores> {
  return {
    trendScore: clamp(Number(snap.trendStrength ?? snap.healthScore ?? 50)),
    momentumScore: clamp(Number(snap.momentumScore ?? 50)),
    volumeScore: clamp(Number(snap.relativeVolume ?? snap.volumeQuote ?? 50) > 100 ? 70 : 50),
    liquidityScore: clamp(Number(snap.liquidityScore ?? 50)),
    orderBookScore: clamp(50 + Number(snap.orderBookImbalance ?? 0) * 10),
    volatilityScore: clamp(Number(snap.volatility ?? 50)),
    regimeScore: snap.regime === "BULL_TREND" || snap.regime === "BREAKOUT" ? 75 : snap.regime === "BEAR_TREND" || snap.regime === "PANIC_DUMP" ? 25 : 50,
  };
}

function scoreFromNews(news: Record<string, unknown>): number {
  const impacts = news.impacts as Array<{ impactScore?: number }> | undefined;
  if (!impacts?.length) return 50;
  return clamp(avg(impacts.map((i) => i.impactScore ?? 50)));
}

function scoreFromWhale(whale: Record<string, unknown>): number {
  const scores = whale.scores as Array<{ whaleActivityScore?: number; accumulationScore?: number }> | undefined;
  if (!scores?.length) return 50;
  return clamp(avg(scores.map((w) => w.whaleActivityScore ?? w.accumulationScore ?? 50)));
}

function scoreFromOnChain(onChain: Record<string, unknown>): number {
  const protocols = onChain.protocols as Array<{ overallHealth?: number }> | undefined;
  if (!protocols?.length) return 50;
  return clamp(avg(protocols.map((p) => p.overallHealth ?? 50)));
}

function scoreFromPortfolio(portfolio: Record<string, unknown>): number {
  const open = Number(portfolio.openPositions ?? 0);
  return clamp(100 - open * 5);
}

function scoreFromRisk(risk: Record<string, unknown>): number {
  const exposure = Number(risk.totalExposure ?? 0);
  const positions = Number(risk.openPositions ?? 0);
  return clamp(100 - positions * 4 - exposure * 0.01);
}

function scoreFromJobs(jobs: Record<string, unknown> | unknown[]): number {
  const list = Array.isArray(jobs) ? jobs : [];
  const completed = list.filter((j) => typeof j === "object" && j && "status" in j && (j as { status: string }).status === "COMPLETED").length;
  return clamp(40 + completed * 12);
}

function scoreFromMetaAi(metaAi: Record<string, unknown>): number {
  if (metaAi.unavailable) return 50;
  return clamp(Number(metaAi.overallConfidence ?? 50));
}

export function buildCanonicalScores(sources: SourceSnapshots): CanonicalScores {
  const snapScores = scoreFromSnapshot(sources.marketSnapshot);
  const newsScore = scoreFromNews(sources.news);
  const whaleScore = scoreFromWhale(sources.whale);
  const onChainScore = scoreFromOnChain(sources.onChain);
  const portfolioScore = scoreFromPortfolio(sources.portfolio);
  const riskScore = scoreFromRisk(sources.risk);
  const learningScore = scoreFromJobs(sources.learning);
  const researchScore = scoreFromJobs(sources.research);
  const metaScore = scoreFromMetaAi(sources.metaAi);

  const trendScore = snapScores.trendScore ?? 50;
  const momentumScore = snapScores.momentumScore ?? 50;
  const volumeScore = snapScores.volumeScore ?? 50;
  const liquidityScore = snapScores.liquidityScore ?? 50;
  const orderBookScore = snapScores.orderBookScore ?? 50;
  const volatilityScore = snapScores.volatilityScore ?? 50;
  const regimeScore = snapScores.regimeScore ?? 50;

  const macroScore = clamp((newsScore + onChainScore + regimeScore) / 3);
  const marketScore = clamp(
    (trendScore + momentumScore + volumeScore + liquidityScore + newsScore + whaleScore + onChainScore) / 7,
  );
  const confidenceScore = clamp(
    (marketScore + riskScore + portfolioScore + metaScore) / 4,
  );

  return {
    marketScore: Number(marketScore.toFixed(1)),
    trendScore: Number(trendScore.toFixed(1)),
    momentumScore: Number(momentumScore.toFixed(1)),
    volumeScore: Number(volumeScore.toFixed(1)),
    liquidityScore: Number(liquidityScore.toFixed(1)),
    orderBookScore: Number(orderBookScore.toFixed(1)),
    newsScore: Number(newsScore.toFixed(1)),
    whaleScore: Number(whaleScore.toFixed(1)),
    onChainScore: Number(onChainScore.toFixed(1)),
    portfolioScore: Number(portfolioScore.toFixed(1)),
    riskScore: Number(riskScore.toFixed(1)),
    learningScore: Number(learningScore.toFixed(1)),
    researchScore: Number(researchScore.toFixed(1)),
    macroScore: Number(macroScore.toFixed(1)),
    regimeScore: Number(regimeScore.toFixed(1)),
    volatilityScore: Number(volatilityScore.toFixed(1)),
    confidenceScore: Number(confidenceScore.toFixed(1)),
  };
}

export async function generateCanonicalObject(
  fusionId: string,
  sources: SourceSnapshots,
  input?: { assetClass?: import("@prisma/client").FusionAssetClass; symbol?: string; confidence?: import("@/src/server/intelligence-fusion/intelligence-fusion.types").ConfidenceFusion },
) {
  const scores = buildCanonicalScores(sources);
  const { persistMarketIntelligence } = await import("@/src/server/intelligence-fusion/intelligence-fusion.repository");
  const intelligence = await persistMarketIntelligence(fusionId, scores, {
    assetClass: input?.assetClass,
    symbol: input?.symbol,
    confidence: input?.confidence,
  });
  return { intelligence, scores };
}
