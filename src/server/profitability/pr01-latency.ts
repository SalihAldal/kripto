import type { FunnelEvent } from "@/src/server/forensics/er01-telemetry-verdict";
import type { LatencyObservation, LatencySegment } from "@/src/server/profitability/pr01-types";

export type LatencyTimelineInput = {
  marketEventAtMs?: number | null;
  availableAtMs?: number | null;
  firstDetectedAtMs?: number | null;
  strategySignalAtMs?: number | null;
  canonicalDecisionAtMs?: number | null;
  intentAtMs?: number | null;
  submitAtMs?: number | null;
  firstFillAtMs?: number | null;
  fullFillAtMs?: number | null;
  clockSkewMs?: number | null;
  retrySubmitAtMs?: number | null;
};

const SEGMENT_PAIRS: Array<{ segment: LatencySegment; startKey: keyof LatencyTimelineInput; endKey: keyof LatencyTimelineInput }> = [
  { segment: "MARKET_EVENT_TO_AVAILABLE", startKey: "marketEventAtMs", endKey: "availableAtMs" },
  { segment: "AVAILABLE_TO_FIRST_DETECTION", startKey: "availableAtMs", endKey: "firstDetectedAtMs" },
  { segment: "FIRST_DETECTION_TO_STRATEGY_SIGNAL", startKey: "firstDetectedAtMs", endKey: "strategySignalAtMs" },
  { segment: "STRATEGY_SIGNAL_TO_CANONICAL_DECISION", startKey: "strategySignalAtMs", endKey: "canonicalDecisionAtMs" },
  { segment: "DECISION_TO_INTENT", startKey: "canonicalDecisionAtMs", endKey: "intentAtMs" },
  { segment: "INTENT_TO_SUBMIT", startKey: "intentAtMs", endKey: "submitAtMs" },
  { segment: "SUBMIT_TO_FIRST_FILL", startKey: "submitAtMs", endKey: "firstFillAtMs" },
  { segment: "FIRST_FILL_TO_FULL_FILL", startKey: "firstFillAtMs", endKey: "fullFillAtMs" },
];

function readMs(input: LatencyTimelineInput, key: keyof LatencyTimelineInput): number | null {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function computeLatencySegment(
  segment: LatencySegment,
  startAtMs: number | null,
  endAtMs: number | null,
  options?: { clockSkewMs?: number | null; isRetry?: boolean },
): LatencyObservation {
  if (startAtMs == null || endAtMs == null) {
    const missingFill = segment === "SUBMIT_TO_FIRST_FILL" || segment === "FIRST_FILL_TO_FULL_FILL";
    return {
      segment,
      startAtMs,
      endAtMs,
      durationMs: null,
      status: missingFill ? "NOT_OBSERVED" : "MISSING",
      reasonCode: missingFill ? "NO_FILL" : "MISSING_TIMESTAMP",
      clockSkewMs: options?.clockSkewMs ?? null,
      isRetry: Boolean(options?.isRetry),
    };
  }
  const durationMs = endAtMs - startAtMs;
  if (durationMs < 0) {
    return {
      segment,
      startAtMs,
      endAtMs,
      durationMs,
      status: "INVALID",
      reasonCode: "NEGATIVE_LATENCY",
      clockSkewMs: options?.clockSkewMs ?? null,
      isRetry: Boolean(options?.isRetry),
    };
  }
  return {
    segment,
    startAtMs,
    endAtMs,
    durationMs,
    status: "OBSERVED",
    reasonCode: null,
    clockSkewMs: options?.clockSkewMs ?? null,
    isRetry: Boolean(options?.isRetry),
  };
}

export function decomposeLatencyTimeline(input: LatencyTimelineInput): LatencyObservation[] {
  const observations = SEGMENT_PAIRS.map(({ segment, startKey, endKey }) =>
    computeLatencySegment(segment, readMs(input, startKey), readMs(input, endKey), {
      clockSkewMs: input.clockSkewMs ?? null,
      isRetry: false,
    }),
  );

  if (input.retrySubmitAtMs != null && input.submitAtMs != null) {
    observations.push(
      computeLatencySegment(
        "INTENT_TO_SUBMIT",
        readMs(input, "intentAtMs"),
        input.retrySubmitAtMs,
        { clockSkewMs: input.clockSkewMs ?? null, isRetry: true },
      ),
    );
  }
  return observations;
}

export function buildLatencyTimelineFromFunnelEvents(events: FunnelEvent[]): LatencyTimelineInput {
  const byKind = (kind: FunnelEvent["kind"]) =>
    events
      .filter((row) => row.kind === kind)
      .map((row) => Date.parse(row.timestamp))
      .filter((ts) => Number.isFinite(ts))
      .sort((a, b) => a - b);

  const first = (values: number[]) => (values.length > 0 ? values[0] : null);
  const last = (values: number[]) => (values.length > 0 ? values[values.length - 1] : null);

  return {
    firstDetectedAtMs: first(byKind("CANDIDATE")),
    strategySignalAtMs: first(byKind("CANDIDATE_EVALUATION")),
    canonicalDecisionAtMs: first(byKind("CANONICAL_DECISION")),
    intentAtMs: first(byKind("ORDER_INTENT")),
    submitAtMs: first(byKind("SUBMIT_ATTEMPT")),
    firstFillAtMs: first(byKind("FILL")),
    fullFillAtMs: last(byKind("FILL")),
  };
}

export type PriceDriftObservation = {
  firstDetectionPrice: number | null;
  signalReferencePrice: number | null;
  decisionEntryPrice: number | null;
  fillPrice: number | null;
  status: "OBSERVED" | "PARTIAL" | "NOT_OBSERVED";
};

export function compareDecisionPrices(input: PriceDriftObservation) {
  const pairs: Array<{ label: string; from: number | null; to: number | null }> = [
    { label: "detection_to_signal", from: input.firstDetectionPrice, to: input.signalReferencePrice },
    { label: "signal_to_decision", from: input.signalReferencePrice, to: input.decisionEntryPrice },
    { label: "decision_to_fill", from: input.decisionEntryPrice, to: input.fillPrice },
  ];
  return pairs.map((row) => {
    if (row.from == null || row.to == null || row.from <= 0) {
      return { label: row.label, driftPct: null, status: "NOT_OBSERVED" as const };
    }
    return {
      label: row.label,
      driftPct: Number((((row.to - row.from) / row.from) * 100).toFixed(6)),
      status: "OBSERVED" as const,
    };
  });
}
