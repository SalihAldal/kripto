import type { HorizonOutcome, OutcomeHorizonMin, PriceSource, TrackedCandidate } from "@/src/server/shadow-outcome/types";

export type CanonicalSourceType = "LIVE_MARKET" | "RECORDED_REPLAY" | "SYNTHETIC_FIXTURE";

export type CanonicalCandidateObservation = {
  datasetId: string;
  campaignId: string;
  candidateId: string;
  symbol: string;
  venue: string;
  lane: string;
  sourceType: CanonicalSourceType;
  marketEventAt: string;
  observedAt: string;
  persistedAt: string;
  firstDetectedAt: string;
  firstDetectedPrice: number;
  firstScore: number | null;
  firstRank: number | null;
  hotAt: string | null;
  hotPrice: number | null;
  microConfirmedAt: string | null;
  microConfirmedPrice: number | null;
  executionReadyAt: string | null;
  executionReadyPrice: number | null;
  canonicalEnterAt: string | null;
  canonicalEnterPrice: number | null;
  riskAllowedAt: string | null;
  paperOpenedAt: string | null;
  firstBlocker: string | null;
  terminalStage: string | null;
  inputSnapshotId: string;
  policyVersion: string;
  dataQuality: "PENDING" | "COMPLETE_OK" | "INCOMPLETE" | "INVALID";
};

export type CandidateOutcomeHorizon = {
  datasetId: string;
  candidateId: string;
  horizonMinutes: OutcomeHorizonMin;
  baselineStage: "FIRST_DETECTED" | "HOT" | "MICRO_CONFIRMED" | "EXECUTION_READY" | "CANONICAL_ENTER";
  baselineAt: string;
  baselinePrice: number;
  horizonEndAt: string;
  lastObservedAt: string;
  mfePercent: number;
  maePercent: number;
  endReturnPercent: number;
  timeToMfeMs: number | null;
  timeToMaeMs: number | null;
  peakPrice: number;
  troughPrice: number;
  observedTicks: number;
  maxGapMs: number;
  quality: "OK" | "INCOMPLETE" | "INVALID";
  final: boolean;
};

export function mapCanonicalSourceType(source: PriceSource): CanonicalSourceType {
  if (source === "replay") return "RECORDED_REPLAY";
  if (source === "synthetic") return "SYNTHETIC_FIXTURE";
  return "LIVE_MARKET";
}

export function buildCanonicalCandidateObservation(input: {
  datasetId: string;
  campaignId: string;
  tracked: TrackedCandidate;
  observedAtMs: number;
  persistedAtMs: number;
  inputSnapshotId: string;
  policyVersion: string;
  previous?: CanonicalCandidateObservation | null;
  venue?: string;
}): CanonicalCandidateObservation {
  const prev = input.previous ?? null;
  const firstDetectedAtIso = prev?.firstDetectedAt ?? toIso(input.tracked.snapshot.firstDetectedAt);
  const firstDetectedPrice = prev?.firstDetectedPrice ?? input.tracked.snapshot.firstDetectionPrice;
  const firstScore = prev?.firstScore ?? toNum(input.tracked.snapshot.opportunityScore);
  const firstRank = prev?.firstRank ?? input.tracked.snapshot.initialRank ?? null;
  const marketEventAt = prev?.marketEventAt ?? firstDetectedAtIso;
  const sourceType = prev?.sourceType ?? mapCanonicalSourceType(input.tracked.snapshot.source);
  const inputSnapshotId = prev?.inputSnapshotId ?? input.inputSnapshotId;

  const terminalStage = resolveTerminalStage(input.tracked.latestStage);
  const dataQuality = resolveObservationQuality(input.tracked, terminalStage);

  return {
    datasetId: input.datasetId,
    campaignId: input.campaignId,
    candidateId: input.tracked.snapshot.candidateId,
    symbol: input.tracked.snapshot.symbol.toUpperCase(),
    venue: (input.venue ?? "BINANCE_TR").toUpperCase(),
    lane: input.tracked.snapshot.primaryLane,
    sourceType,
    marketEventAt,
    observedAt: toIso(input.observedAtMs),
    persistedAt: toIso(input.persistedAtMs),
    firstDetectedAt: firstDetectedAtIso,
    firstDetectedPrice,
    firstScore,
    firstRank,
    hotAt: toIsoOrNull(input.tracked.hotAt),
    hotPrice: priceAt(input.tracked, input.tracked.hotAt),
    microConfirmedAt: toIsoOrNull(input.tracked.microConfirmedAt),
    microConfirmedPrice: priceAt(input.tracked, input.tracked.microConfirmedAt),
    executionReadyAt: toIsoOrNull(input.tracked.executionReadyAt),
    executionReadyPrice: priceAt(input.tracked, input.tracked.executionReadyAt),
    canonicalEnterAt: stageAt(input.tracked, "CANONICAL_ENTER"),
    canonicalEnterPrice: stagePrice(input.tracked, "CANONICAL_ENTER"),
    riskAllowedAt: stageAt(input.tracked, "RISK_ALLOWED"),
    paperOpenedAt: stageAt(input.tracked, "PAPER_OPENED"),
    firstBlocker: terminalStage === "REJECTED" ? extractBlockerCode(input.tracked) : null,
    terminalStage,
    inputSnapshotId,
    policyVersion: input.policyVersion,
    dataQuality,
  };
}

export function buildOutcomeHorizonRows(input: {
  datasetId: string;
  tracked: TrackedCandidate;
  baselineStage: CandidateOutcomeHorizon["baselineStage"];
}): CandidateOutcomeHorizon[] {
  const baselineAtMs = resolveBaselineMs(input.tracked, input.baselineStage);
  const baselinePrice = resolveBaselinePrice(input.tracked, input.baselineStage);
  if (baselineAtMs == null || baselinePrice == null || !Number.isFinite(baselinePrice) || baselinePrice <= 0) return [];
  const points = input.tracked.pricePoints.filter((row) => row.t >= baselineAtMs).sort((a, b) => a.t - b.t);
  const lastObservedAt = points.length ? points[points.length - 1]!.t : baselineAtMs;
  const maxGapMs = computeMaxGap(points);
  const peak = points.reduce((acc, row) => Math.max(acc, row.high ?? row.price), baselinePrice);
  const trough = points.reduce((acc, row) => Math.min(acc, row.low ?? row.price), baselinePrice);

  return input.tracked.outcomes.map((out) => toOutcomeRow({
    datasetId: input.datasetId,
    candidateId: input.tracked.snapshot.candidateId,
    baselineAtMs,
    baselinePrice,
    lastObservedAt,
    maxGapMs,
    peak,
    trough,
    out,
    observedTicks: points.length,
    baselineStage: input.baselineStage,
  }));
}

function toOutcomeRow(input: {
  datasetId: string;
  candidateId: string;
  baselineAtMs: number;
  baselinePrice: number;
  lastObservedAt: number;
  maxGapMs: number;
  peak: number;
  trough: number;
  out: HorizonOutcome;
  observedTicks: number;
  baselineStage: CandidateOutcomeHorizon["baselineStage"];
}): CandidateOutcomeHorizon {
  const horizonEndAtMs = input.baselineAtMs + input.out.horizonMin * 60_000;
  const final = input.out.status !== "PENDING";
  const quality: CandidateOutcomeHorizon["quality"] =
    input.out.status === "INVALID_DATA" || input.out.status === "HISTORY_UNAVAILABLE"
      ? "INVALID"
      : input.out.quality === "OUTCOME_DATA_INCOMPLETE"
        ? "INCOMPLETE"
        : "OK";
  return {
    datasetId: input.datasetId,
    candidateId: input.candidateId,
    horizonMinutes: input.out.horizonMin,
    baselineStage: input.baselineStage,
    baselineAt: toIso(input.baselineAtMs),
    baselinePrice: input.baselinePrice,
    horizonEndAt: toIso(horizonEndAtMs),
    lastObservedAt: toIso(input.lastObservedAt),
    mfePercent: input.out.mfePct ?? 0,
    maePercent: input.out.maePct ?? 0,
    endReturnPercent: input.out.returnPct ?? 0,
    timeToMfeMs: input.out.timeToMfeMs,
    timeToMaeMs: null,
    peakPrice: input.peak,
    troughPrice: input.trough,
    observedTicks: input.observedTicks,
    maxGapMs: input.maxGapMs,
    quality,
    final,
  };
}

function resolveBaselineMs(tracked: TrackedCandidate, baseline: CandidateOutcomeHorizon["baselineStage"]): number | null {
  if (baseline === "FIRST_DETECTED") return tracked.snapshot.firstDetectedAt;
  if (baseline === "HOT") return tracked.hotAt;
  if (baseline === "MICRO_CONFIRMED") return tracked.microConfirmedAt;
  if (baseline === "EXECUTION_READY") return tracked.executionReadyAt;
  return fromIsoOrNull(stageAt(tracked, "CANONICAL_ENTER"));
}

function resolveBaselinePrice(tracked: TrackedCandidate, baseline: CandidateOutcomeHorizon["baselineStage"]): number | null {
  if (baseline === "FIRST_DETECTED") return tracked.snapshot.firstDetectionPrice;
  if (baseline === "HOT") return priceAt(tracked, tracked.hotAt);
  if (baseline === "MICRO_CONFIRMED") return priceAt(tracked, tracked.microConfirmedAt);
  if (baseline === "EXECUTION_READY") return priceAt(tracked, tracked.executionReadyAt);
  return stagePrice(tracked, "CANONICAL_ENTER");
}

function resolveObservationQuality(tracked: TrackedCandidate, terminalStage: string | null): CanonicalCandidateObservation["dataQuality"] {
  if (tracked.invalidReason) return "INVALID";
  if (terminalStage === "OPEN" || terminalStage === "CLOSED") return "COMPLETE_OK";
  if (terminalStage === "REJECTED") return "INCOMPLETE";
  return "PENDING";
}

function resolveTerminalStage(latestStage: string): string | null {
  const upper = String(latestStage ?? "").toUpperCase();
  if (!upper) return null;
  if (upper.includes("PAPER_OPENED") || upper === "OPEN") return "OPEN";
  if (upper.includes("CLOSED")) return "CLOSED";
  if (upper.includes("REJECT") || upper.includes("BLOCK")) return "REJECTED";
  return upper;
}

function extractBlockerCode(tracked: TrackedCandidate): string | null {
  const reasons = tracked.snapshot.reasonCodes ?? [];
  const blocked = reasons.find((reason) => String(reason).includes("REJECT") || String(reason).includes("BLOCK"));
  return blocked ?? null;
}

function stageAt(tracked: TrackedCandidate, stage: string): string | null {
  const event = tracked.journey.find((row) => row.stage === stage);
  return event ? toIso(event.at) : null;
}

function stagePrice(tracked: TrackedCandidate, stage: string): number | null {
  const event = tracked.journey.find((row) => row.stage === stage);
  return event ? priceAt(tracked, event.at) : null;
}

function priceAt(tracked: TrackedCandidate, at: number | null): number | null {
  if (at == null) return null;
  const point = [...tracked.pricePoints].reverse().find((row) => row.t <= at);
  return point?.price ?? null;
}

function computeMaxGap(points: Array<{ t: number }>): number {
  let max = 0;
  for (let i = 1; i < points.length; i += 1) {
    max = Math.max(max, points[i]!.t - points[i - 1]!.t);
  }
  return max;
}

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function toIsoOrNull(ms: number | null): string | null {
  return ms == null ? null : toIso(ms);
}

function fromIsoOrNull(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toNum(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value);
}
