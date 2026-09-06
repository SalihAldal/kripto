import type { HorizonOutcome, OutcomeHorizonMin, PriceSource, TrackedCandidate } from "@/src/server/shadow-outcome/types";
import { OUTCOME_HORIZONS_MIN } from "@/src/server/shadow-outcome/types";
import { computeOneHorizon, type PricePoint } from "@/src/server/shadow-outcome/metrics";

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
  baselineStage: "FIRST_DETECTED" | "HOT" | "MICRO_CONFIRMED" | "EXECUTION_READY" | "CANONICAL_ENTER" | "EXECUTION_FILL";
  baselineAt: string;
  baselinePrice: number;
  horizonEndAt: string;
  lastObservedAt: string;
  mfePercent: number | null;
  maePercent: number | null;
  endReturnPercent: number | null;
  timeToMfeMs: number | null;
  timeToMaeMs: number | null;
  peakPrice: number | null;
  troughPrice: number | null;
  observedTicks: number;
  maxGapMs: number;
  quality: "OK" | "INCOMPLETE" | "INVALID";
  status: HorizonOutcome["status"];
  invalidReason?: string | null;
  final: boolean;
};

const DEFAULT_GAP_MS = 120_000;
const BASELINE_PRICE_MAX_AGE_MS = 120_000;

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
  const firstDetectedAtIso = prev ? prev.firstDetectedAt : toIso(input.tracked.snapshot.firstDetectedAt);
  const firstDetectedPrice = prev ? prev.firstDetectedPrice : input.tracked.snapshot.firstDetectionPrice;
  const firstScore = prev ? prev.firstScore : toNum(input.tracked.snapshot.opportunityScore);
  const firstRank = prev ? prev.firstRank : input.tracked.snapshot.initialRank ?? null;
  const marketEventAt = prev ? prev.marketEventAt : firstDetectedAtIso;
  const sourceType = prev ? prev.sourceType : mapCanonicalSourceType(input.tracked.snapshot.source);
  const inputSnapshotId = prev ? prev.inputSnapshotId : input.inputSnapshotId;

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

function resolveBaselineMs(tracked: TrackedCandidate, baseline: CandidateOutcomeHorizon["baselineStage"]): number | null {
  if (baseline === "FIRST_DETECTED") return tracked.snapshot.firstDetectedAt;
  if (baseline === "HOT") return tracked.hotAt;
  if (baseline === "MICRO_CONFIRMED") return tracked.microConfirmedAt;
  if (baseline === "EXECUTION_READY") return tracked.executionReadyAt;
  if (baseline === "EXECUTION_FILL") return fromIsoOrNull(stageAt(tracked, "PAPER_OPENED"));
  return fromIsoOrNull(stageAt(tracked, "CANONICAL_ENTER"));
}

function resolveBaselinePrice(tracked: TrackedCandidate, baseline: CandidateOutcomeHorizon["baselineStage"]): number | null {
  if (baseline === "FIRST_DETECTED") return tracked.snapshot.firstDetectionPrice;
  if (baseline === "HOT") return priceAt(tracked, tracked.hotAt, BASELINE_PRICE_MAX_AGE_MS);
  if (baseline === "MICRO_CONFIRMED") return priceAt(tracked, tracked.microConfirmedAt, BASELINE_PRICE_MAX_AGE_MS);
  if (baseline === "EXECUTION_READY") return priceAt(tracked, tracked.executionReadyAt, BASELINE_PRICE_MAX_AGE_MS);
  if (baseline === "EXECUTION_FILL") return stagePrice(tracked, "PAPER_OPENED");
  return stagePrice(tracked, "CANONICAL_ENTER");
}

function resolveObservationQuality(tracked: TrackedCandidate, terminalStage: string | null): CanonicalCandidateObservation["dataQuality"] {
  if (tracked.invalidReason) return "INVALID";
  const outcomes = tracked.outcomes ?? [];
  if (!outcomes.length) return terminalStage === "REJECTED" ? "INCOMPLETE" : "PENDING";
  const statuses = outcomes.map((row) => row.status);
  if (statuses.some((row) => row === "PENDING")) return "PENDING";
  if (statuses.every((row) => row === "COMPLETE")) return "COMPLETE_OK";
  return "INCOMPLETE";
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

function priceAt(tracked: TrackedCandidate, at: number | null, maxAgeMs = Number.POSITIVE_INFINITY): number | null {
  if (at == null) return null;
  const point = [...tracked.pricePoints].reverse().find((row) => row.t <= at);
  if (!point) return null;
  if (at - point.t > maxAgeMs) return null;
  return point.price;
}

function toWindowStats(points: PricePoint[], baselineAtMs: number, horizonEndAtMs: number) {
  const window = points
    .filter((row) => row.t >= baselineAtMs && row.t <= horizonEndAtMs)
    .sort((a, b) => a.t - b.t);
  const observedTicks = window.length;
  const lastObservedAtMs = window.length ? window[window.length - 1]!.t : baselineAtMs;
  let maxGapMs = 0;
  if (window.length > 0) {
    maxGapMs = Math.max(maxGapMs, window[0]!.t - baselineAtMs);
  }
  for (let i = 1; i < window.length; i += 1) {
    maxGapMs = Math.max(maxGapMs, window[i]!.t - window[i - 1]!.t);
  }
  const peakPrice = window.reduce<number | null>(
    (acc, row) => {
      const high = row.high ?? row.price;
      return acc == null ? high : Math.max(acc, high);
    },
    null,
  );
  const troughPrice = window.reduce<number | null>(
    (acc, row) => {
      const low = row.low ?? row.price;
      return acc == null ? low : Math.min(acc, low);
    },
    null,
  );
  return { window, observedTicks, lastObservedAtMs, maxGapMs, peakPrice, troughPrice };
}

export function buildOutcomeHorizonRows(input: {
  datasetId: string;
  tracked: TrackedCandidate;
  baselineStage: CandidateOutcomeHorizon["baselineStage"];
  nowMs?: number;
}): CandidateOutcomeHorizon[] {
  const baselineAtMs = resolveBaselineMs(input.tracked, input.baselineStage);
  const baselinePrice = resolveBaselinePrice(input.tracked, input.baselineStage);
  if (baselineAtMs == null || baselinePrice == null || !Number.isFinite(baselinePrice) || baselinePrice <= 0) return [];
  const points = [...input.tracked.pricePoints].sort((a, b) => a.t - b.t);
  const nowMs = input.nowMs ?? Date.now();
  return OUTCOME_HORIZONS_MIN.map((horizonMin) => {
    const horizonEndAtMs = baselineAtMs + horizonMin * 60_000;
    const out = computeOneHorizon({
      detectedAt: baselineAtMs,
      detectionPrice: baselinePrice,
      points,
      now: nowMs,
      gapMs: DEFAULT_GAP_MS,
      horizonMin,
      lookaheadSafe: true,
    });
    const quality: CandidateOutcomeHorizon["quality"] =
      out.status === "INVALID_DATA" || out.status === "HISTORY_UNAVAILABLE"
        ? "INVALID"
        : out.quality === "OUTCOME_DATA_INCOMPLETE"
          ? "INCOMPLETE"
          : "OK";
    const stats = toWindowStats(points, baselineAtMs, horizonEndAtMs);
    return {
      datasetId: input.datasetId,
      candidateId: input.tracked.snapshot.candidateId,
      horizonMinutes: horizonMin,
      baselineStage: input.baselineStage,
      baselineAt: toIso(baselineAtMs),
      baselinePrice,
      horizonEndAt: toIso(horizonEndAtMs),
      lastObservedAt: toIso(stats.lastObservedAtMs),
      mfePercent: out.mfePct,
      maePercent: out.maePct,
      endReturnPercent: out.returnPct,
      timeToMfeMs: out.timeToMfeMs,
      timeToMaeMs: out.timeToMaeMs ?? null,
      peakPrice: stats.peakPrice,
      troughPrice: stats.troughPrice,
      observedTicks: stats.observedTicks,
      maxGapMs: stats.maxGapMs,
      quality,
      status: out.status,
      invalidReason: out.invalidReason ?? null,
      final: out.status !== "PENDING",
    };
  });
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
