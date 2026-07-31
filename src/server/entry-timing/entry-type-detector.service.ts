import type { SpotEntryType } from "@prisma/client";
import type { EntryConfirmation, EntryContext, MicroStructureAnalysis } from "@/src/server/entry-timing/entry-timing.types";

export function detectEntryType(
  ctx: EntryContext,
  micro: MicroStructureAnalysis,
  confirmation: EntryConfirmation,
): SpotEntryType {
  if (ctx.news.uncertainty > 60 && ctx.news.score < 40) return "NEWS";
  if (micro.signals.includes("VOLUME_EXPANSION") && micro.bos && confirmation.breakoutProbability > 55) return "BREAKOUT";
  if (micro.bos && confirmation.pullbackProbability > 45) return "RETEST";
  if (confirmation.pullbackProbability > 55 && ctx.support.distancePct < 1.5) return "PULLBACK";
  if (ctx.momentum.shortMomentum > 1.5 && confirmation.continuationProbability > 50) return "MOMENTUM";
  if (micro.higherHigh && micro.higherLow && ctx.trend.direction.includes("BULL")) return "TREND_CONTINUATION";
  if (ctx.regime.label.includes("RANGE") && ctx.support.distancePct < 1) return "RANGE_BOUNCE";
  if (ctx.support.distancePct < 0.8 && ctx.support.score > 70) return "SUPPORT_BOUNCE";
  if (ctx.resistance.distancePct < 0.5 && confirmation.breakoutProbability > 60) return "RESISTANCE_FLIP";
  if (ctx.price > 0 && ctx.volume.score > 60) return "VWAP";
  if (micro.choch && micro.volumeExpansion) return "LIQUIDITY_SWEEP";
  return "MOMENTUM";
}
