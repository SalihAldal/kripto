import type { EntryFilterReason } from "@prisma/client";
import type { EntryConfirmation, EntryContext, EntryFilterResult, MicroStructureAnalysis } from "@/src/server/entry-timing/entry-timing.types";

export function applyEntryFilters(
  ctx: EntryContext,
  micro: MicroStructureAnalysis,
  confirmation: EntryConfirmation,
): EntryFilterResult {
  const reasons: EntryFilterReason[] = [];
  const rejectMessages: string[] = [];

  if (confirmation.fakeBreakoutProbability > 55) {
    reasons.push("FAKE_BREAKOUT_RISK");
    rejectMessages.push("Fake breakout probability elevated");
  }
  if (ctx.volume.relativeVolume < 0.6 || ctx.volume.score < 35) {
    reasons.push("WEAK_VOLUME");
    rejectMessages.push("Volume confirmation insufficient");
  }
  if (ctx.whale.activity > 70 && ctx.volume.delta < 0) {
    reasons.push("DISTRIBUTION");
    rejectMessages.push("Distribution pattern detected");
  }
  if (ctx.momentum.shortMomentum > 4 || ctx.resistance.distancePct < 0.3) {
    reasons.push("EXTREME_OVEREXTENSION");
    rejectMessages.push("Price overextended from structure");
  }
  if (micro.choch && confirmation.reversalProbability > 45) {
    reasons.push("LIQUIDITY_TRAP");
    rejectMessages.push("Liquidity sweep / trap risk");
  }
  if (ctx.news.uncertainty > 65) {
    reasons.push("NEWS_UNCERTAINTY");
    rejectMessages.push("News uncertainty too high");
  }
  if (!ctx.exchange.stable) {
    reasons.push("EXCHANGE_INSTABILITY");
    rejectMessages.push("Exchange connectivity unstable");
  }
  if (confirmation.entryConfidence < 45) {
    reasons.push("LOW_CONFIDENCE");
    rejectMessages.push("Entry confidence below threshold");
  }

  return { passed: reasons.length === 0, reasons, rejectMessages };
}
