import type { ExitVerdict } from "@prisma/client";
import type { ExitScoreResult } from "@/src/server/exit-timing/exit-timing.types";
import { persistExitQuality } from "@/src/server/exit-timing/exit-timing.repository";

export async function scoreExitQuality(
  analysisId: string,
  symbol: string,
  scores: ExitScoreResult,
  verdict: ExitVerdict,
  profitGivebackPct: number,
) {
  const baseQuality =
    scores.exitConfidence * 0.35 +
    (100 - scores.riskScore) * 0.25 +
    scores.continuationProbability * 0.2 +
    (100 - profitGivebackPct * 2) * 0.2;

  const verdictAdjust = verdict === "SELL" ? 5 : -5;
  const qualityScore = Math.max(0, Math.min(100, baseQuality + verdictAdjust));

  const record = await persistExitQuality({
    analysisId,
    symbol,
    qualityScore: Number(qualityScore.toFixed(1)),
    extraProfitPossiblePct: scores.expectedRemainingUpside,
    drawdownAvoidablePct: profitGivebackPct,
    couldExitEarlier: profitGivebackPct > 2,
    couldExitLater: scores.continuationProbability > 60,
  });

  return record;
}
