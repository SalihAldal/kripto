import { discoverOpenPositions, collectExitContext } from "@/src/server/exit-timing/exit-context.service";
import { computeProfitProtection } from "@/src/server/exit-timing/profit-protection.service";
import { computeExitScore, detectExitType } from "@/src/server/exit-timing/exit-score.service";
import { resolveExitVerdict } from "@/src/server/exit-timing/hold-mode.service";
import { scoreExitQuality } from "@/src/server/exit-timing/exit-quality.service";
import { publishExitRecommendation } from "@/src/server/exit-timing/exit-recommendation.service";
import { persistExitAnalysis } from "@/src/server/exit-timing/exit-timing.repository";
import { emitExitTimingEvent, EXIT_TIMING_EVENT } from "@/src/server/exit-timing/exit-timing.events";
import { PARTIAL_EXIT_ARCH, TRAILING_ARCH } from "@/src/server/exit-timing/exit-timing.types";

export async function analyzeExitTiming(input: { symbol?: string; positionId?: string }) {
  let positions = await discoverOpenPositions(20);
  if (input.positionId) positions = positions.filter((p) => p.id === input.positionId);
  if (input.symbol) positions = positions.filter((p) => p.symbol.toUpperCase() === input.symbol!.toUpperCase());
  if (positions.length === 0) throw new Error("No open positions to analyze");

  const position = positions[0]!;
  const ctx = await collectExitContext(position);
  if (!ctx) throw new Error(`No exit context for ${position.symbol}`);

  const protection = await computeProfitProtection(ctx);
  const scores = computeExitScore(ctx, protection);
  const exitType = detectExitType(ctx, protection, scores);
  const verdictResult = resolveExitVerdict(ctx, protection, scores);

  const analysis = await persistExitAnalysis({
    positionId: ctx.positionId,
    symbol: ctx.symbol,
    entryPrice: ctx.entryPrice,
    currentPrice: ctx.currentPrice,
    currentProfitPct: ctx.currentProfitPct,
    currentLossPct: ctx.currentLossPct,
    verdict: verdictResult.verdict,
    exitType,
    exitScore: scores.exitScore,
    exitConfidence: scores.exitConfidence,
    expectedRemainingUpside: scores.expectedRemainingUpside,
    expectedDownside: scores.expectedDownside,
    riskScore: scores.riskScore,
    continuationProbability: scores.continuationProbability,
    reversalProbability: scores.reversalProbability,
    holdDuration: verdictResult.holdDuration,
    reevaluateAt: verdictResult.reevaluateAt,
    momentumScore: ctx.momentum.score,
    trendScore: ctx.trend.score,
    volumeScore: ctx.volume.score,
    regimeScore: ctx.regime.score,
    orderBookScore: ctx.orderBook.score,
    liquidityScore: ctx.liquidity.score,
    newsScore: ctx.news.score,
    whaleScore: ctx.whale.score,
    onChainScore: ctx.onChain.score,
    volatilityScore: ctx.volatility.score,
    atrValue: ctx.volatility.atr,
    vwapDistance: ctx.vwap.distancePct,
    supportScore: ctx.support.score,
    resistanceScore: ctx.resistance.score,
    partialExitPct: PARTIAL_EXIT_ARCH.productionPct,
    trailingMode: TRAILING_ARCH.activeMode,
    analysisPayload: { context: ctx, protection, scores, partialExit: PARTIAL_EXIT_ARCH, trailing: TRAILING_ARCH },
  });

  const quality = await scoreExitQuality(analysis.id, ctx.symbol, scores, verdictResult.verdict, protection.profitGivebackPct);
  const recommendation = await publishExitRecommendation(analysis, exitType, verdictResult);

  emitExitTimingEvent(EXIT_TIMING_EVENT.ANALYSIS_COMPLETED, { analysisKey: analysis.analysisKey, symbol: ctx.symbol, verdict: verdictResult.verdict });
  if (verdictResult.verdict === "SELL") emitExitTimingEvent(EXIT_TIMING_EVENT.VERDICT_SELL, { symbol: ctx.symbol });
  else emitExitTimingEvent(EXIT_TIMING_EVENT.VERDICT_HOLD, { symbol: ctx.symbol, reevaluateAt: verdictResult.reevaluateAt });

  return { analysis, quality, recommendation, protection, scores, verdict: verdictResult };
}

export async function scanAllOpenPositions() {
  const positions = await discoverOpenPositions(20);
  const results = [];
  for (const pos of positions) {
    try {
      results.push(await analyzeExitTiming({ positionId: pos.id, symbol: pos.symbol }));
    } catch {
      /* skip */
    }
  }
  return { analyzed: results.length, results };
}
