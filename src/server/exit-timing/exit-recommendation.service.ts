import type { ExitAnalysis, SpotExitType } from "@prisma/client";
import { persistExitRecommendation } from "@/src/server/exit-timing/exit-timing.repository";
import { emitExitTimingEvent, EXIT_TIMING_EVENT } from "@/src/server/exit-timing/exit-timing.events";
import { PARTIAL_EXIT_ARCH, TRAILING_ARCH } from "@/src/server/exit-timing/exit-timing.types";

export async function publishExitRecommendation(
  analysis: ExitAnalysis,
  exitType: SpotExitType,
  verdictResult: { verdict: ExitAnalysis["verdict"]; reasons: string[]; reevaluateAt?: Date },
) {
  const summary =
    verdictResult.verdict === "SELL"
      ? `SELL 100% now — ${exitType.replace(/_/g, " ").toLowerCase()} (score ${analysis.exitScore})`
      : `HOLD — re-evaluate at ${verdictResult.reevaluateAt?.toISOString() ?? "scheduled time"}`;

  const recommendation = await persistExitRecommendation({
    analysisId: analysis.id,
    positionId: analysis.positionId ?? undefined,
    symbol: analysis.symbol,
    verdict: verdictResult.verdict,
    exitType,
    exitScore: analysis.exitScore,
    confidence: analysis.exitConfidence,
    summary,
    reasons: verdictResult.reasons,
    holdUntil: verdictResult.reevaluateAt,
    expiresAt: verdictResult.reevaluateAt
      ? new Date(verdictResult.reevaluateAt.getTime() + 3600_000)
      : new Date(Date.now() + 3600_000),
    metadata: {
      partialExit: PARTIAL_EXIT_ARCH,
      trailing: TRAILING_ARCH,
      sellPct: "PCT_100",
    },
  });

  emitExitTimingEvent(EXIT_TIMING_EVENT.RECOMMENDATION_PUBLISHED, {
    recommendationKey: recommendation.recommendationKey,
    verdict: verdictResult.verdict,
  });
  return recommendation;
}
