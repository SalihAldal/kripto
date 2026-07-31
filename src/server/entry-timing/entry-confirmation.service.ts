import type { EntryContext, EntryConfirmation } from "@/src/server/entry-timing/entry-timing.types";
import type { MicroStructureAnalysis } from "@/src/server/entry-timing/entry-timing.types";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export function computeEntryConfirmation(
  ctx: EntryContext,
  micro: MicroStructureAnalysis,
): EntryConfirmation {
  const bullishBias =
    ctx.trend.score * 0.18 +
    ctx.momentum.score * 0.16 +
    ctx.volume.score * 0.12 +
    ctx.liquidity.score * 0.1 +
    ctx.structure.score * 0.14 +
    ctx.support.score * 0.08 +
    (100 - ctx.resistance.distancePct * 3) * 0.06 +
    ctx.whale.score * 0.06 +
    ctx.onChain.score * 0.05 +
    ctx.news.score * 0.05;

  const entryScore = clamp(bullishBias);
  const entryConfidence = clamp(
    entryScore * 0.5 +
      (micro.microTrend === "BULLISH" ? 25 : micro.microTrend === "BEARISH" ? -15 : 5) +
      (micro.bos ? 10 : 0) +
      (ctx.momentum.breakoutProb * 0.15),
  );

  const fakeBreakoutProbability = clamp(
    (ctx.resistance.distancePct < 0.5 ? 35 : 10) +
      (micro.volumeExpansion && !micro.bos ? 20 : 0) +
      (ctx.volume.relativeVolume < 0.8 ? 15 : 0) +
      (ctx.momentum.shortMomentum > 3 ? 15 : 0),
  );

  const breakoutProbability = clamp(ctx.momentum.breakoutProb + (micro.bos ? 15 : 0) - fakeBreakoutProbability * 0.3);
  const continuationProbability = clamp(entryScore * 0.6 + (micro.higherHigh && micro.higherLow ? 20 : 0));
  const pullbackProbability = clamp(100 - continuationProbability - fakeBreakoutProbability * 0.5);
  const reversalProbability = clamp(
    (micro.choch ? 40 : 10) + (micro.lowerLow ? 20 : 0) + (ctx.trend.direction.includes("BEAR") ? 25 : 0),
  );

  const entryRisk = clamp(
    fakeBreakoutProbability * 0.3 +
      reversalProbability * 0.25 +
      (100 - ctx.liquidity.score) * 0.2 +
      ctx.volatility.score * 0.15 +
      ctx.news.uncertainty * 0.1,
  );

  return {
    entryScore: Number(entryScore.toFixed(1)),
    entryConfidence: Number(entryConfidence.toFixed(1)),
    entryRisk: Number(entryRisk.toFixed(1)),
    breakoutProbability: Number(breakoutProbability.toFixed(1)),
    continuationProbability: Number(continuationProbability.toFixed(1)),
    pullbackProbability: Number(pullbackProbability.toFixed(1)),
    fakeBreakoutProbability: Number(fakeBreakoutProbability.toFixed(1)),
    reversalProbability: Number(reversalProbability.toFixed(1)),
  };
}
