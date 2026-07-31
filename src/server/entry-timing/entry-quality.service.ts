import type { EntryVerdict } from "@prisma/client";
import type { EntryConfirmation, EntryQualityResult } from "@/src/server/entry-timing/entry-timing.types";
import { persistEntryQuality } from "@/src/server/entry-timing/entry-timing.repository";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export async function scoreEntryQuality(
  analysisId: string,
  symbol: string,
  confirmation: EntryConfirmation,
  verdict: EntryVerdict,
): Promise<EntryQualityResult & { id: string }> {
  const baseQuality =
    confirmation.entryScore * 0.35 +
    confirmation.entryConfidence * 0.35 +
    (100 - confirmation.entryRisk) * 0.2 +
    confirmation.continuationProbability * 0.1;

  const verdictPenalty = verdict === "REJECT" ? -30 : verdict === "WAIT" ? -10 : 0;
  const qualityScore = clamp(baseQuality + verdictPenalty);

  const expectedRr = Number((1.5 + confirmation.continuationProbability / 100).toFixed(2));
  const expectedSuccess = Number((confirmation.entryConfidence * 0.7 + confirmation.continuationProbability * 0.3).toFixed(1));
  const expectedHoldMinutes = Number((30 + confirmation.pullbackProbability * 0.5).toFixed(0));
  const expectedVolatility = Number((confirmation.entryRisk * 0.8).toFixed(1));

  const record = await persistEntryQuality({
    analysisId,
    symbol,
    qualityScore: Number(qualityScore.toFixed(1)),
    expectedRr,
    expectedSuccess,
    expectedHoldMinutes,
    expectedVolatility,
  });

  return {
    id: record.id,
    qualityScore: record.qualityScore,
    expectedRr,
    expectedSuccess,
    expectedHoldMinutes,
    expectedVolatility,
  };
}
