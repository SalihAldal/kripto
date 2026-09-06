import type {
  Pr05ExperimentManifest,
  Pr05OfflineComparisonReport,
  Pr05TradeOutcome,
  Pr05VariantAggregate,
} from "@/src/server/profitability/pr05-types";

export function evaluateOfflineCandidate(input: {
  experimentManifest: Pr05ExperimentManifest;
  recordedMarketAvailable: boolean;
  closedTradeCount: number;
  independentLifecycleGroups: number;
  holdoutUsable: boolean;
  negativeControlVerdict: string;
  aggregates: Pr05VariantAggregate[];
  baselinePolicyId: string;
}): {
  offlineCandidateVerdict: Pr05OfflineComparisonReport["offlineCandidateVerdict"];
  selectedCandidateIds: string[];
  profitabilityEvidence: Pr05OfflineComparisonReport["profitabilityEvidence"];
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!input.recordedMarketAvailable) {
    reasons.push("PR05-DATA-01: no recorded market replay package");
    return {
      offlineCandidateVerdict: "INSUFFICIENT_DATA",
      selectedCandidateIds: [],
      profitabilityEvidence: "INSUFFICIENT_DATA",
      reasons,
    };
  }
  if (input.independentLifecycleGroups < input.experimentManifest.minIndependentLifecycleGroups) {
    reasons.push("INSUFFICIENT_INDEPENDENT_LIFECYCLE_GROUPS");
    return {
      offlineCandidateVerdict: "INSUFFICIENT_DATA",
      selectedCandidateIds: [],
      profitabilityEvidence: "INSUFFICIENT_DATA",
      reasons,
    };
  }
  if (input.closedTradeCount < input.experimentManifest.minClosedTradesPerSplit) {
    reasons.push("INSUFFICIENT_CLOSED_TRADES");
    return {
      offlineCandidateVerdict: "INSUFFICIENT_DATA",
      selectedCandidateIds: [],
      profitabilityEvidence: "INSUFFICIENT_DATA",
      reasons,
    };
  }
  if (!input.holdoutUsable) {
    reasons.push("HOLDOUT_PROVENANCE_UNKNOWN");
    return {
      offlineCandidateVerdict: "NO_CANDIDATE_SUPPORTED",
      selectedCandidateIds: [],
      profitabilityEvidence: "NOT_ESTABLISHED",
      reasons,
    };
  }
  if (input.negativeControlVerdict === "FAIL") {
    reasons.push("NEGATIVE_CONTROL_FAIL");
    return {
      offlineCandidateVerdict: "INVALID_EVIDENCE",
      selectedCandidateIds: [],
      profitabilityEvidence: "INVALID_EVIDENCE",
      reasons,
    };
  }
  const baseline = input.aggregates.find((a) => a.exitPolicyId === input.baselinePolicyId);
  const candidates = input.aggregates.filter(
    (a) =>
      a.exitPolicyId !== input.baselinePolicyId &&
      a.netExpectancyStatus === "KNOWN" &&
      a.netExpectancy != null &&
      baseline?.netExpectancy != null &&
      a.netExpectancy > baseline.netExpectancy,
  );
  if (!candidates.length) {
    reasons.push("NO_VARIANT_BEATS_BASELINE_ON_HOLDOUT");
    return {
      offlineCandidateVerdict: "NO_CANDIDATE_SUPPORTED",
      selectedCandidateIds: [],
      profitabilityEvidence: "NOT_ESTABLISHED",
      reasons,
    };
  }
  return {
    offlineCandidateVerdict: "OFFLINE_CANDIDATE_SUPPORTED",
    selectedCandidateIds: candidates.map((c) => c.variantKey),
    profitabilityEvidence: "NOT_ESTABLISHED",
    reasons: ["HOLDOUT_BEATS_BASELINE_BUT_LIVE_PROMOTION_NOT_GRANTED"],
  };
}

export function outcomesToTradeRows(input: {
  outcomes: Pr05TradeOutcome[];
  split: Pr05TradeOutcome["split"];
}) {
  return input.outcomes.filter((o) => o.split === input.split);
}
