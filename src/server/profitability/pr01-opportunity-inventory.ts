import { MOVER_SPECS } from "@/src/server/shadow-outcome/config";
import { matchingCandidate } from "@/src/server/shadow-outcome/analytics";
import type { MoverEvent, TrackedCandidate } from "@/src/server/shadow-outcome/types";
import type { FunnelEvent } from "@/src/server/forensics/er01-telemetry-verdict";
import {
  type JoinConfidence,
  type MoveBucketReport,
  type OpportunityCohort,
  type OpportunityLifecycleRecord,
} from "@/src/server/profitability/pr01-types";

export type OpportunityInventoryInput = {
  trackedCandidates: TrackedCandidate[];
  movers: MoverEvent[];
  funnelEvents?: FunnelEvent[];
  enterCandidateIds?: Set<string>;
  executedCandidateIds?: Set<string>;
  campaignId?: string | null;
};

function lifecycleId(symbol: string, anchorMs: number) {
  return `lc_${symbol}_${anchorMs}`;
}

export function dedupeMovers(movers: MoverEvent[]) {
  const grouped = new Map<string, MoverEvent>();
  for (const mover of movers) {
    const key = `${mover.symbol}:${mover.moveClass}:${mover.horizonMin}`;
    const prev = grouped.get(key);
    if (!prev || mover.thresholdReachedAt < prev.thresholdReachedAt) {
      grouped.set(key, mover);
    }
  }
  return Array.from(grouped.values());
}

export function buildOpportunityLifecycleRecords(input: OpportunityInventoryInput): OpportunityLifecycleRecord[] {
  const movers = dedupeMovers(input.movers);
  const enterIds = input.enterCandidateIds ?? new Set<string>();
  const executedIds = input.executedCandidateIds ?? new Set<string>();
  const records: OpportunityLifecycleRecord[] = [];

  for (const mover of movers) {
    const cand = matchingCandidate(mover, input.trackedCandidates);
    const cohorts: OpportunityCohort[] = ["F_RETROSPECTIVE_SIGNIFICANT_MOVE"];
    if (cand) cohorts.push("B_SYSTEM_DETECTED");
    if (cand && (cand.snapshot.microScore != null || cand.latestTdiDecision)) {
      cohorts.push("C_STRATEGY_EVALUATED");
    }
    if (cand && enterIds.has(cand.snapshot.candidateId)) cohorts.push("D_ENTER_DECISION");
    if (cand && executedIds.has(cand.snapshot.candidateId)) cohorts.push("E_EXECUTED_SETTLED");

    records.push({
      lifecycleId: lifecycleId(mover.symbol, mover.thresholdReachedAt),
      symbol: mover.symbol,
      venue: "BINANCE_TR",
      quoteCurrency: mover.symbol.endsWith("TRY") ? "TRY" : mover.symbol.endsWith("USDT") ? "USDT" : "UNKNOWN",
      horizonMin: mover.horizonMin,
      moveOnsetType: "CAUSAL_THRESHOLD",
      thresholdCrossingAtMs: mover.thresholdReachedAt,
      retrospectiveOnsetAtMs: mover.moveStartAt,
      sourceCoverageQuality: "PARTIAL",
      systemDetected: Boolean(cand),
      firstDetectedAtMs: cand?.snapshot.firstDetectedAt ?? null,
      eligibleForExecution: cand ? cand.snapshot.executionQuality != null : null,
      cohortsReached: cohorts,
      joinConfidence: cand ? "HIGH" : "UNKNOWN",
      joinStatus: cand ? "JOINED" : "UNMATCHED",
      candidateId: cand?.snapshot.candidateId ?? null,
      decisionId: null,
      strategyId: null,
    });
  }

  for (const tracked of input.trackedCandidates) {
    const id = tracked.snapshot.candidateId;
    const already = records.some((row) => row.candidateId === id);
    if (already) continue;
    const cohorts: OpportunityCohort[] = ["B_SYSTEM_DETECTED"];
    if (tracked.snapshot.microScore != null || tracked.latestTdiDecision) cohorts.push("C_STRATEGY_EVALUATED");
    if (enterIds.has(id)) cohorts.push("D_ENTER_DECISION");
    if (executedIds.has(id)) cohorts.push("E_EXECUTED_SETTLED");
    records.push({
      lifecycleId: lifecycleId(tracked.snapshot.symbol, tracked.snapshot.firstDetectedAt),
      symbol: tracked.snapshot.symbol,
      venue: "BINANCE_TR",
      quoteCurrency: tracked.snapshot.symbol.endsWith("TRY") ? "TRY" : "USDT",
      horizonMin: null,
      moveOnsetType: null,
      thresholdCrossingAtMs: null,
      retrospectiveOnsetAtMs: null,
      sourceCoverageQuality: "PARTIAL",
      systemDetected: true,
      firstDetectedAtMs: tracked.snapshot.firstDetectedAt,
      eligibleForExecution: tracked.snapshot.executionQuality != null,
      cohortsReached: cohorts,
      joinConfidence: "HIGH",
      joinStatus: "JOINED",
      candidateId: id,
      decisionId: null,
      strategyId: null,
    });
  }

  return records;
}

export function summarizeOpportunityCohorts(records: OpportunityLifecycleRecord[]) {
  const counts: Record<OpportunityCohort, number> = {
    A_MARKET_OBSERVATIONS: 0,
    B_SYSTEM_DETECTED: 0,
    C_STRATEGY_EVALUATED: 0,
    D_ENTER_DECISION: 0,
    E_EXECUTED_SETTLED: 0,
    F_RETROSPECTIVE_SIGNIFICANT_MOVE: 0,
  };
  for (const record of records) {
    for (const cohort of record.cohortsReached) counts[cohort] += 1;
  }
  return counts;
}

export function classifyMoveOnset(mover: MoverEvent) {
  return {
    causalThresholdAtMs: mover.thresholdReachedAt,
    retrospectiveLabelAtMs: mover.moveStartAt,
    onsetTypes: {
      threshold: "CAUSAL_THRESHOLD" as const,
      moveStart: "RETROSPECTIVE_LABEL" as const,
    },
  };
}

export function buildMoveBucketReports(input: {
  movers: MoverEvent[];
  tracked: TrackedCandidate[];
  economicsBreakEvenPct?: Map<string, number | null>;
}): MoveBucketReport[] {
  const movers = dedupeMovers(input.movers);
  return MOVER_SPECS.map((spec) => {
    const members = movers.filter((row) => row.moveClass === spec.moveClass && row.horizonMin === spec.horizonMin);
    let detected = 0;
    let executable = 0;
    let executableUnknown = 0;
    let remainingMoveSum = 0;
    let remainingMoveCount = 0;
    let costRatioSum = 0;
    let costRatioCount = 0;

    for (const mover of members) {
      const cand = matchingCandidate(mover, input.tracked);
      if (cand) {
        detected += 1;
        const detectPrice = cand.snapshot.firstDetectionPrice;
        const peak = mover.peakPrice;
        if (detectPrice > 0 && peak > detectPrice) {
          remainingMoveSum += ((peak - detectPrice) / detectPrice) * 100;
          remainingMoveCount += 1;
        }
        if (cand.snapshot.executionQuality != null) executable += 1;
        else executableUnknown += 1;
        const breakEven = input.economicsBreakEvenPct?.get(cand.snapshot.candidateId) ?? null;
        if (breakEven != null && mover.peakMovePct > 0) {
          costRatioSum += (breakEven / mover.peakMovePct) * 100;
          costRatioCount += 1;
        }
      }
    }

    return {
      bucketId: `move_${spec.moveClass}_h${spec.horizonMin}`,
      moveClassPct: spec.moveClass,
      sampleCount: members.length,
      detectedCount: detected,
      undetectedCount: Math.max(0, members.length - detected),
      unknownCoverageCount: 0,
      executableCount: executable,
      executableUnknownCount: executableUnknown,
      avgCostRatioPct: costRatioCount > 0 ? Number((costRatioSum / costRatioCount).toFixed(4)) : null,
      avgRemainingMoveAfterDetectionPct:
        remainingMoveCount > 0 ? Number((remainingMoveSum / remainingMoveCount).toFixed(4)) : null,
    };
  });
}

export function joinConfidenceFromMatch(candidate: TrackedCandidate | undefined, mover: MoverEvent): JoinConfidence {
  if (!candidate) return "UNKNOWN";
  const delta = Math.abs(candidate.snapshot.firstDetectedAt - mover.thresholdReachedAt);
  if (delta <= 60_000) return "HIGH";
  if (delta <= 5 * 60_000) return "MEDIUM";
  return "LOW";
}
