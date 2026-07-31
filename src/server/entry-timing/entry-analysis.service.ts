import { collectEntryContext } from "@/src/server/entry-timing/entry-context.service";
import { analyzeMicroStructure, structureScoreFromMicro } from "@/src/server/entry-timing/micro-structure.service";
import { computeEntryConfirmation } from "@/src/server/entry-timing/entry-confirmation.service";
import { detectEntryType } from "@/src/server/entry-timing/entry-type-detector.service";
import { applyEntryFilters } from "@/src/server/entry-timing/entry-filters.service";
import { resolveEntryVerdict } from "@/src/server/entry-timing/wait-mode.service";
import { scoreEntryQuality } from "@/src/server/entry-timing/entry-quality.service";
import { publishEntryRecommendation } from "@/src/server/entry-timing/entry-recommendation.service";
import { persistEntryAnalysis } from "@/src/server/entry-timing/entry-timing.repository";
import { emitEntryTimingEvent, ENTRY_TIMING_EVENT } from "@/src/server/entry-timing/entry-timing.events";

export async function analyzeEntryTiming(symbol: string, price?: number) {
  const ctx = await collectEntryContext(symbol, price);
  if (!ctx) throw new Error(`No market context for ${symbol}`);

  const micro = await analyzeMicroStructure(symbol);
  const structureScore = structureScoreFromMicro(micro);
  ctx.structure.score = structureScore;

  const confirmation = computeEntryConfirmation(ctx, micro);
  const entryType = detectEntryType(ctx, micro, confirmation);
  const filters = applyEntryFilters(ctx, micro, confirmation);
  const verdictResult = resolveEntryVerdict(confirmation, filters);

  const analysis = await persistEntryAnalysis({
    symbol: ctx.symbol,
    priceAtAnalysis: ctx.price,
    verdict: verdictResult.verdict,
    entryType,
    entryScore: confirmation.entryScore,
    entryConfidence: confirmation.entryConfidence,
    entryRisk: confirmation.entryRisk,
    breakoutProbability: confirmation.breakoutProbability,
    continuationProbability: confirmation.continuationProbability,
    pullbackProbability: confirmation.pullbackProbability,
    fakeBreakoutProbability: confirmation.fakeBreakoutProbability,
    reversalProbability: confirmation.reversalProbability,
    waitDuration: verdictResult.waitDuration,
    reevaluateAt: verdictResult.reevaluateAt,
    trendScore: ctx.trend.score,
    momentumScore: ctx.momentum.score,
    volumeScore: ctx.volume.score,
    liquidityScore: ctx.liquidity.score,
    orderBookScore: ctx.orderBook.score,
    volatilityScore: ctx.volatility.score,
    supportScore: ctx.support.score,
    resistanceScore: ctx.resistance.score,
    structureScore: ctx.structure.score,
    regimeScore: ctx.regime.score,
    newsScore: ctx.news.score,
    whaleScore: ctx.whale.score,
    onChainScore: ctx.onChain.score,
    microStructure: micro,
    filterReasons: filters.reasons,
    filterPassed: filters.passed,
    analysisPayload: { context: ctx, confirmation, filters: filters.rejectMessages },
  });

  const quality = await scoreEntryQuality(analysis.id, ctx.symbol, confirmation, verdictResult.verdict);
  const recommendation = await publishEntryRecommendation(analysis, entryType, quality, verdictResult);

  emitEntryTimingEvent(ENTRY_TIMING_EVENT.ANALYSIS_COMPLETED, { analysisKey: analysis.analysisKey, symbol: ctx.symbol, verdict: verdictResult.verdict });
  if (verdictResult.verdict === "BUY") emitEntryTimingEvent(ENTRY_TIMING_EVENT.VERDICT_BUY, { symbol: ctx.symbol });
  else if (verdictResult.verdict === "WAIT") emitEntryTimingEvent(ENTRY_TIMING_EVENT.VERDICT_WAIT, { symbol: ctx.symbol, reevaluateAt: verdictResult.reevaluateAt });
  else emitEntryTimingEvent(ENTRY_TIMING_EVENT.VERDICT_REJECT, { symbol: ctx.symbol });

  return { analysis, quality, recommendation, micro, verdict: verdictResult };
}

export async function analyzeMultipleSymbols(limit = 5) {
  const { discoverAnalysisSymbols } = await import("@/src/server/entry-timing/entry-context.service");
  const symbols = await discoverAnalysisSymbols(limit);
  const results = [];
  for (const symbol of symbols) {
    try {
      results.push(await analyzeEntryTiming(symbol));
    } catch {
      /* skip unavailable symbols */
    }
  }
  return { analyzed: results.length, results };
}
