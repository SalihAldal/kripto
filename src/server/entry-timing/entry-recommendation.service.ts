import type { EntryAnalysis, SpotEntryType } from "@prisma/client";
import type { EntryQualityResult } from "@/src/server/entry-timing/entry-timing.types";
import { persistEntryRecommendation } from "@/src/server/entry-timing/entry-timing.repository";
import { emitEntryTimingEvent, ENTRY_TIMING_EVENT } from "@/src/server/entry-timing/entry-timing.events";

export async function publishEntryRecommendation(
  analysis: EntryAnalysis,
  entryType: SpotEntryType,
  quality: EntryQualityResult,
  verdictResult: { verdict: EntryAnalysis["verdict"]; reasons: string[]; reevaluateAt?: Date },
) {
  const summary =
    verdictResult.verdict === "BUY"
      ? `BUY now — ${entryType.replace(/_/g, " ").toLowerCase()} setup (quality ${quality.qualityScore})`
      : verdictResult.verdict === "WAIT"
        ? `WAIT — re-evaluate at ${verdictResult.reevaluateAt?.toISOString() ?? "scheduled time"}`
        : `REJECT — entry timing unfavorable`;

  const recommendation = await persistEntryRecommendation({
    analysisId: analysis.id,
    symbol: analysis.symbol,
    verdict: verdictResult.verdict,
    entryType,
    qualityScore: quality.qualityScore,
    confidence: analysis.entryConfidence,
    summary,
    reasons: verdictResult.reasons,
    waitUntil: verdictResult.reevaluateAt,
    expiresAt: verdictResult.reevaluateAt ? new Date(verdictResult.reevaluateAt.getTime() + 3600_000) : new Date(Date.now() + 3600_000),
    metadata: { expectedRr: quality.expectedRr, expectedSuccess: quality.expectedSuccess },
  });

  emitEntryTimingEvent(ENTRY_TIMING_EVENT.RECOMMENDATION_PUBLISHED, {
    recommendationKey: recommendation.recommendationKey,
    verdict: verdictResult.verdict,
  });
  return recommendation;
}
