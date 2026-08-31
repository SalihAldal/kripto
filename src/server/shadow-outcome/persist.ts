import { getShadowOutcomeEngine } from "@/src/server/shadow-outcome/shadow-outcome-engine";

/** Best-effort batch persist. Never blocks the market tick. Never places orders. */
export async function persistShadowOutcomes() {
  const engine = getShadowOutcomeEngine();
  if (!engine.shouldPersist()) return { wrote: 0 };
  const rows = engine.getTracked();
  try {
    const mod = await import("@/src/server/db/prisma").catch(() => null);
    const prisma = (mod as { prisma?: unknown } | null)?.prisma as
      | { shadowCandidateOutcome?: { upsert: (args: unknown) => Promise<unknown> } }
      | undefined;
    if (!prisma?.shadowCandidateOutcome) {
      engine.markPersisted();
      return { wrote: 0, reason: "MODEL_UNAVAILABLE" as const };
    }
    let wrote = 0;
    for (const row of rows) {
      if (row.snapshot.source === "synthetic") continue;
      await prisma.shadowCandidateOutcome.upsert({
        where: { candidateId: row.snapshot.candidateId },
        create: toRow(row),
        update: {
          snapshot: row.snapshot,
          latestStage: row.latestStage,
          latestScore: row.latestScore,
          latestRank: row.latestRank,
          outcomes: row.outcomes,
          reachTimes: row.reachTimes,
          journey: row.journey,
          invalidReason: row.invalidReason,
          updatedAt: new Date(),
        },
      });
      wrote += 1;
    }
    engine.markPersisted();
    return { wrote };
  } catch {
    engine.markPersisted();
    return { wrote: 0, reason: "PERSIST_FAILED" as const };
  }
}

function toRow(row: ReturnType<ReturnType<typeof getShadowOutcomeEngine>["getTracked"]>[number]) {
  return {
    candidateId: row.snapshot.candidateId,
    symbol: row.snapshot.symbol,
    detectedAt: new Date(row.snapshot.firstDetectedAt),
    firstDetectionPrice: row.snapshot.firstDetectionPrice,
    lane: row.snapshot.primaryLane,
    finalScore: row.snapshot.finalScore,
    moveKey: row.moveKey,
    snapshot: row.snapshot,
    journey: row.journey,
    latestStage: row.latestStage,
    latestScore: row.latestScore,
    latestRank: row.latestRank,
    outcomes: row.outcomes,
    reachTimes: row.reachTimes,
    invalidReason: row.invalidReason,
    source: row.snapshot.source,
  };
}
