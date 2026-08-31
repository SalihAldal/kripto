import { getShadowOutcomeEngine } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { getForensicSession } from "@/src/server/forensics/forensic-context";
import { matchingCandidate } from "@/src/server/shadow-outcome/analytics";

type DynamicPrisma = {
  shadowCandidateOutcome?: { upsert: (args: unknown) => Promise<unknown> };
  $executeRawUnsafe?: (query: string, ...params: unknown[]) => Promise<unknown>;
};

/** Best-effort batch persist. Never blocks the market tick. Never places orders. */
export async function persistShadowOutcomes() {
  const engine = getShadowOutcomeEngine();
  if (!engine.shouldPersist()) return { wrote: 0 };
  const rows = engine.getTracked();
  try {
    const mod = await import("@/src/server/db/prisma").catch(() => null);
    const prisma = (mod as { prisma?: unknown } | null)?.prisma as DynamicPrisma | undefined;
    const session = getForensicSession();
    const runId = session?.runId ?? null;
    if (!prisma?.shadowCandidateOutcome) {
      return { wrote: 0, reason: "MODEL_UNAVAILABLE" as const };
    }
    let wrote = 0;
    for (const row of rows) {
      if (row.snapshot.source === "synthetic") continue;
      await prisma.shadowCandidateOutcome.upsert({
        where: { candidateId: row.snapshot.candidateId },
        create: toRow(row, runId),
        update: {
          runId,
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
    const moversWrote = await persistMoverEvents(prisma, runId).catch(() => 0);
    engine.markPersisted();
    return { wrote, moversWrote };
  } catch {
    return { wrote: 0, reason: "PERSIST_FAILED" as const };
  }
}

async function persistMoverEvents(prisma: DynamicPrisma, runId: string | null) {
  if (!prisma.$executeRawUnsafe) return 0;
  const engine = getShadowOutcomeEngine();
  const movers = engine.getMoverEvents();
  const rows = engine.getTracked();
  let wrote = 0;
  for (const mover of movers) {
    const candidate = matchingCandidate(mover, rows);
    const dedupeBucket = Math.floor(mover.thresholdReachedAt / Math.max(1, mover.horizonMin * 60_000 * 0.5));
    const dedupeKey = `${mover.symbol}:${mover.moveClass}:${dedupeBucket}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ShadowMoverEvent" (
        "moverId","runId","symbol","venue","threshold","horizonMin","moveStartAt","moveStartPrice","thresholdReachedAt","thresholdPrice","peakAt","peakPrice","peakMovePercent","status","dedupeKey","systemDetected","candidateId","firstDetectedAt","firstDetectedPrice","lane","hot","microAnalyzed","microConfirmed","finalRanked","executionReady","riskAllowed","paperOpened","createdAt","updatedAt"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,to_timestamp($7 / 1000.0),$8,to_timestamp($9 / 1000.0),$10,to_timestamp($11 / 1000.0),$12,$13,$14,$15,$16,$17,to_timestamp($18 / 1000.0),$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW(),NOW()
      )
      ON CONFLICT ("dedupeKey") DO UPDATE SET
        "runId"=EXCLUDED."runId",
        "thresholdReachedAt"=EXCLUDED."thresholdReachedAt",
        "thresholdPrice"=EXCLUDED."thresholdPrice",
        "peakAt"=EXCLUDED."peakAt",
        "peakPrice"=EXCLUDED."peakPrice",
        "peakMovePercent"=EXCLUDED."peakMovePercent",
        "status"=EXCLUDED."status",
        "systemDetected"=EXCLUDED."systemDetected",
        "candidateId"=EXCLUDED."candidateId",
        "firstDetectedAt"=EXCLUDED."firstDetectedAt",
        "firstDetectedPrice"=EXCLUDED."firstDetectedPrice",
        "lane"=EXCLUDED."lane",
        "hot"=EXCLUDED."hot",
        "microAnalyzed"=EXCLUDED."microAnalyzed",
        "microConfirmed"=EXCLUDED."microConfirmed",
        "finalRanked"=EXCLUDED."finalRanked",
        "executionReady"=EXCLUDED."executionReady",
        "riskAllowed"=EXCLUDED."riskAllowed",
        "paperOpened"=EXCLUDED."paperOpened",
        "updatedAt"=NOW()`,
      mover.moverId,
      runId,
      mover.symbol,
      "BINANCE_GLOBAL",
      mover.moveClass,
      mover.horizonMin,
      mover.moveStartAt,
      mover.moveStartPrice,
      mover.thresholdReachedAt,
      mover.thresholdPrice,
      mover.peakAt,
      mover.peakPrice,
      mover.peakMovePct,
      mover.status,
      dedupeKey,
      candidate != null,
      candidate?.snapshot.candidateId ?? null,
      candidate?.snapshot.firstDetectedAt ?? null,
      candidate?.snapshot.firstDetectionPrice ?? null,
      candidate?.snapshot.primaryLane ?? null,
      candidate?.hotAt != null,
      candidate?.journey.some((item) => item.stage === "MICRO_ANALYZED" || item.stage === "WARMING") ?? false,
      candidate?.microConfirmedAt != null,
      candidate?.journey.some((item) => item.stage === "FINAL_RANKED") ?? false,
      candidate?.executionReadyAt != null,
      candidate?.journey.some((item) => item.stage === "RISK_ALLOWED") ?? false,
      candidate?.journey.some((item) => item.stage === "PAPER_OPENED") ?? false,
    );
    wrote += 1;
  }
  return wrote;
}

function toRow(row: ReturnType<ReturnType<typeof getShadowOutcomeEngine>["getTracked"]>[number], runId: string | null) {
  return {
    runId,
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
