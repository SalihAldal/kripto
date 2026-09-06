import { getShadowOutcomeEngine } from "@/src/server/shadow-outcome/shadow-outcome-engine";
import { getForensicSession } from "@/src/server/forensics/forensic-context";
import { matchingCandidate } from "@/src/server/shadow-outcome/analytics";
import { assertCampaignId } from "@/src/server/forensics/campaign-identity.service";
import {
  buildCanonicalCandidateObservation,
  buildOutcomeHorizonRows,
  type CandidateOutcomeHorizon,
  type CanonicalCandidateObservation,
} from "@/src/server/shadow-outcome/canonical-dataset";

type DynamicPrisma = {
  shadowCandidateOutcome?: {
    upsert: (args: unknown) => Promise<unknown>;
    findUnique: (args: unknown) => Promise<unknown>;
  };
  shadowMoverEvent?: { upsert: (args: unknown) => Promise<unknown> };
};

const CANONICAL_DATASET_SCHEMA_VERSION = "er05-dataset-v1";
const CANONICAL_POLICY_VERSION = "er05-canonical-baseline-v1";
const CANONICAL_BASELINES: CandidateOutcomeHorizon["baselineStage"][] = [
  "FIRST_DETECTED",
  "HOT",
  "MICRO_CONFIRMED",
  "EXECUTION_READY",
  "CANONICAL_ENTER",
  "EXECUTION_FILL",
];

/** Best-effort batch persist. Never blocks the market tick. Never places orders. */
export async function persistShadowOutcomes() {
  const engine = getShadowOutcomeEngine();
  if (!engine.shouldPersist()) return { wrote: 0 };
  const rows = engine.getTracked();
  const session = getForensicSession();
  const runId = session?.runId ?? null;
  const campaignId = session?.campaignId ?? null;
  if (!campaignId) {
    engine.noteRegistration({ attempts: rows.length, failure: rows.length });
    return { wrote: 0, reason: "CAMPAIGN_IDENTITY_MISSING" as const };
  }
  try {
    const mod = await import("@/src/server/db/prisma").catch(() => null);
    const prisma = (mod as { prisma?: unknown } | null)?.prisma as DynamicPrisma | undefined;
    if (!prisma?.shadowCandidateOutcome) {
      engine.noteRegistration({ attempts: rows.length, failure: rows.length });
      return { wrote: 0, reason: "MODEL_UNAVAILABLE" as const };
    }
    let wrote = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.snapshot.source === "synthetic") continue;
      try {
        const existingRaw = await prisma.shadowCandidateOutcome.findUnique({
          where: { candidateId: row.snapshot.candidateId },
          select: { snapshot: true },
        });
        const existing = (existingRaw ?? null) as { snapshot?: unknown } | null;
        const snapshot = buildCanonicalSnapshot({
          tracked: row,
          campaignId,
          runId,
          existingSnapshot: existing?.snapshot ?? null,
        });
        await prisma.shadowCandidateOutcome.upsert({
          where: { candidateId: row.snapshot.candidateId },
          create: toRow(row, runId, campaignId, snapshot),
          update: {
            runId,
            campaignId,
            snapshot,
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
      } catch {
        failed += 1;
      }
    }
    engine.noteRegistration({ attempts: rows.length, success: wrote, failure: failed });
    const moverResult = await persistMoverEvents(prisma, runId, campaignId).catch(() => ({ wrote: 0, failed: 0 }));
    engine.markPersisted();
    return { wrote, moversWrote: moverResult.wrote, moverPersistFailures: moverResult.failed };
  } catch {
    engine.noteRegistration({ attempts: rows.length, failure: rows.length });
    return { wrote: 0, reason: "PERSIST_FAILED" as const };
  }
}

async function persistMoverEvents(prisma: DynamicPrisma, runId: string | null, campaignId: string) {
  assertCampaignId(campaignId);
  if (!prisma.shadowMoverEvent) return { wrote: 0, failed: 0 };
  const engine = getShadowOutcomeEngine();
  const movers = engine.getMoverEvents();
  const rows = engine.getTracked();
  let wrote = 0;
  let failed = 0;
  for (const mover of movers) {
    const candidate = matchingCandidate(mover, rows);
    const dedupeBucket = Math.floor(mover.thresholdReachedAt / Math.max(1, mover.horizonMin * 60_000 * 0.5));
    const dedupeKey = `${mover.symbol}:${mover.moveClass}:${dedupeBucket}`;
    try {
      await prisma.shadowMoverEvent.upsert({
        where: { dedupeKey },
        create: {
          moverId: mover.moverId,
          campaignId,
          runId,
          symbol: mover.symbol,
          venue: "BINANCE_TR",
          threshold: mover.moveClass,
          horizonMin: mover.horizonMin,
          moveStartAt: new Date(mover.moveStartAt),
          moveStartPrice: mover.moveStartPrice,
          thresholdReachedAt: new Date(mover.thresholdReachedAt),
          thresholdPrice: mover.thresholdPrice,
          peakAt: new Date(mover.peakAt),
          peakPrice: mover.peakPrice,
          peakMovePercent: mover.peakMovePct,
          status: mover.status,
          dedupeKey,
          systemDetected: candidate != null,
          candidateId: candidate?.snapshot.candidateId ?? null,
          firstDetectedAt: candidate?.snapshot.firstDetectedAt ? new Date(candidate.snapshot.firstDetectedAt) : null,
          firstDetectedPrice: candidate?.snapshot.firstDetectionPrice ?? null,
          lane: candidate?.snapshot.primaryLane ?? null,
          hot: candidate?.hotAt != null,
          microAnalyzed: candidate?.journey.some((item) => item.stage === "MICRO_ANALYZED" || item.stage === "WARMING") ?? false,
          microConfirmed: candidate?.microConfirmedAt != null,
          finalRanked: candidate?.journey.some((item) => item.stage === "FINAL_RANKED") ?? false,
          executionReady: candidate?.executionReadyAt != null,
          riskAllowed: candidate?.journey.some((item) => item.stage === "RISK_ALLOWED") ?? false,
          paperOpened: candidate?.journey.some((item) => item.stage === "PAPER_OPENED") ?? false,
        },
        update: {
          campaignId,
          runId,
          thresholdReachedAt: new Date(mover.thresholdReachedAt),
          thresholdPrice: mover.thresholdPrice,
          peakAt: new Date(mover.peakAt),
          peakPrice: mover.peakPrice,
          peakMovePercent: mover.peakMovePct,
          status: mover.status,
          systemDetected: candidate != null,
          candidateId: candidate?.snapshot.candidateId ?? null,
          firstDetectedAt: candidate?.snapshot.firstDetectedAt ? new Date(candidate.snapshot.firstDetectedAt) : null,
          firstDetectedPrice: candidate?.snapshot.firstDetectionPrice ?? null,
          lane: candidate?.snapshot.primaryLane ?? null,
          hot: candidate?.hotAt != null,
          microAnalyzed: candidate?.journey.some((item) => item.stage === "MICRO_ANALYZED" || item.stage === "WARMING") ?? false,
          microConfirmed: candidate?.microConfirmedAt != null,
          finalRanked: candidate?.journey.some((item) => item.stage === "FINAL_RANKED") ?? false,
          executionReady: candidate?.executionReadyAt != null,
          riskAllowed: candidate?.journey.some((item) => item.stage === "RISK_ALLOWED") ?? false,
          paperOpened: candidate?.journey.some((item) => item.stage === "PAPER_OPENED") ?? false,
        },
      });
      wrote += 1;
    } catch {
      failed += 1;
    }
  }
  return { wrote, failed };
}

function toRow(
  row: ReturnType<ReturnType<typeof getShadowOutcomeEngine>["getTracked"]>[number],
  runId: string | null,
  campaignId: string,
  snapshot: Record<string, unknown>,
) {
  return {
    campaignId,
    runId,
    candidateId: row.snapshot.candidateId,
    symbol: row.snapshot.symbol,
    detectedAt: new Date(row.snapshot.firstDetectedAt),
    firstDetectionPrice: row.snapshot.firstDetectionPrice,
    lane: row.snapshot.primaryLane,
    finalScore: row.snapshot.finalScore,
    moveKey: row.moveKey,
    snapshot,
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

function buildCanonicalSnapshot(input: {
  tracked: ReturnType<ReturnType<typeof getShadowOutcomeEngine>["getTracked"]>[number];
  campaignId: string;
  runId: string | null;
  existingSnapshot: unknown;
}) {
  const datasetId = resolveDatasetId(input.campaignId, input.runId);
  const existingSnapshot = asRecord(input.existingSnapshot);
  const existingCanonical = asRecord(existingSnapshot?.canonicalDataset);
  const previousObservation = asCanonicalObservation(existingCanonical?.observation);
  const now = Date.now();
  const observation = buildCanonicalCandidateObservation({
    datasetId,
    campaignId: input.campaignId,
    tracked: input.tracked,
    observedAtMs: now,
    persistedAtMs: now,
    inputSnapshotId: resolveInputSnapshotId(input.tracked),
    policyVersion: CANONICAL_POLICY_VERSION,
    previous: previousObservation,
    venue: "BINANCE_TR",
  });
  const horizonsByBaseline = Object.fromEntries(
    CANONICAL_BASELINES.map((baseline) => [
      baseline,
      buildOutcomeHorizonRows({
        datasetId,
        tracked: input.tracked,
        baselineStage: baseline,
        nowMs: now,
      }),
    ]),
  ) as Record<string, CandidateOutcomeHorizon[]>;
  const identityQuality = observation.candidateId ? "LINKED" : "UNRESOLVED";
  const featureQuality = observation.inputSnapshotId ? "SNAPSHOT_PRESENT" : "SNAPSHOT_MISSING";
  const firstDetectedRows = horizonsByBaseline.FIRST_DETECTED ?? [];
  const hasPending = firstDetectedRows.some((row) => row.status === "PENDING");
  const hasInvalid = firstDetectedRows.some((row) => row.status === "INVALID_DATA" || row.status === "HISTORY_UNAVAILABLE");
  const priceCoverageQuality = hasInvalid ? "GAPPED_OR_MISSING" : hasPending ? "PENDING" : "COVERED";
  const executionEvidenceQuality =
    observation.paperOpenedAt != null && observation.terminalStage === "CLOSED"
      ? "SETTLED_PAPER_EVIDENCE"
      : observation.paperOpenedAt != null
        ? "OPEN_ONLY"
        : "NO_EXECUTION_EVIDENCE";
  const finalizationState = hasPending ? "PENDING" : "FINALIZED";
  return {
    ...input.tracked.snapshot,
    canonicalDataset: {
      schemaVersion: CANONICAL_DATASET_SCHEMA_VERSION,
      policyVersion: CANONICAL_POLICY_VERSION,
      datasetId,
      observation,
      horizonsByBaseline,
      qualityDimensions: {
        identityQuality,
        featureQuality,
        priceCoverageQuality,
        executionEvidenceQuality,
        finalizationState,
      },
      generatedAt: new Date(now).toISOString(),
    },
  } as Record<string, unknown>;
}

function resolveDatasetId(campaignId: string, runId: string | null) {
  const normalizedRun = (runId ?? "run-unknown").trim() || "run-unknown";
  return `${campaignId}:${normalizedRun}:${CANONICAL_DATASET_SCHEMA_VERSION}`;
}

function resolveInputSnapshotId(row: ReturnType<ReturnType<typeof getShadowOutcomeEngine>["getTracked"]>[number]) {
  return `${row.snapshot.candidateId}:${row.snapshot.firstDetectedAt}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asCanonicalObservation(value: unknown): CanonicalCandidateObservation | null {
  const rec = asRecord(value);
  if (!rec) return null;
  if (typeof rec.candidateId !== "string") return null;
  if (typeof rec.datasetId !== "string") return null;
  if (typeof rec.firstDetectedAt !== "string") return null;
  return rec as unknown as CanonicalCandidateObservation;
}
