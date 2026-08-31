export const EV_TELEMETRY_REASON_CODES = [
  "EV_PASS",
  "EV_WAIT",
  "EV_REJECT_THRESHOLD",
  "EV_REJECT_DATA",
  "EV_REJECT_FEE",
  "EV_REJECT_RISK",
  "HYBRID_DECISION_MIRROR",
  "EV_UNKNOWN",
] as const;

export type EvTelemetryReasonCode = (typeof EV_TELEMETRY_REASON_CODES)[number];

export type HybridEvTelemetryInput = {
  finalDecision: "BUY" | "HOLD" | "NO_TRADE" | "SELL";
  composite: number;
  threshold: number;
  compositeOk: boolean;
  rejectReason?: string;
  riskVeto?: boolean;
  noTradeReasonList?: string[];
};

function includesFeeSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("fee") || lower.includes("spread") || lower.includes("maliyet");
}

function includesDataSignal(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("data") ||
    lower.includes("missing") ||
    lower.includes("invalid") ||
    lower.includes("snapshot") ||
    lower.includes("quality")
  );
}

export function classifyHybridEvTelemetry(input: HybridEvTelemetryInput): {
  verdict: "APPROVED" | "WAIT" | "REJECTED" | "UNKNOWN";
  reasonCode: EvTelemetryReasonCode;
} {
  if (input.finalDecision === "BUY") {
    return { verdict: "APPROVED", reasonCode: "EV_PASS" };
  }
  if (input.finalDecision === "HOLD") {
    return { verdict: "WAIT", reasonCode: "EV_WAIT" };
  }

  const compositePassesThreshold = input.compositeOk || input.composite >= input.threshold;
  const reasonText = [
    input.rejectReason ?? "",
    ...(input.noTradeReasonList ?? []),
  ]
    .filter(Boolean)
    .join(" | ");

  if (!compositePassesThreshold) {
    return { verdict: "REJECTED", reasonCode: "EV_REJECT_THRESHOLD" };
  }

  if (input.riskVeto || reasonText.toLowerCase().includes("veto") || reasonText.toLowerCase().includes("risk")) {
    return { verdict: "REJECTED", reasonCode: "EV_REJECT_RISK" };
  }
  if (includesFeeSignal(reasonText)) {
    return { verdict: "REJECTED", reasonCode: "EV_REJECT_FEE" };
  }
  if (includesDataSignal(reasonText)) {
    return { verdict: "REJECTED", reasonCode: "EV_REJECT_DATA" };
  }

  return { verdict: "REJECTED", reasonCode: "HYBRID_DECISION_MIRROR" };
}

export type EvAnomalyReplayRow = {
  candidateId: string;
  symbol: string;
  expectedValue: number;
  threshold: number;
  verdict: string;
  reasonCode: string;
  formulaVersion: string;
};

export function replayEvAnomalyClassification(row: EvAnomalyReplayRow): {
  classification: "REAL_EV_REJECTION" | "HYBRID_DECISION_MIRROR" | "OTHER";
  replayReasonCode: EvTelemetryReasonCode;
} {
  const compositePasses = row.expectedValue >= row.threshold;
  if (row.reasonCode === "EV_PASS" || row.verdict === "APPROVED") {
    return { classification: "OTHER", replayReasonCode: "EV_PASS" };
  }

  if (!compositePasses) {
    return { classification: "REAL_EV_REJECTION", replayReasonCode: "EV_REJECT_THRESHOLD" };
  }

  const replay = classifyHybridEvTelemetry({
    finalDecision: "NO_TRADE",
    composite: row.expectedValue,
    threshold: row.threshold,
    compositeOk: compositePasses,
    rejectReason: row.reasonCode === "EV_REJECT" ? "hybrid upstream block" : row.reasonCode,
  });

  if (replay.reasonCode === "HYBRID_DECISION_MIRROR") {
    return { classification: "HYBRID_DECISION_MIRROR", replayReasonCode: replay.reasonCode };
  }
  if (
    replay.reasonCode === "EV_REJECT_THRESHOLD" ||
    replay.reasonCode === "EV_REJECT_DATA" ||
    replay.reasonCode === "EV_REJECT_FEE" ||
    replay.reasonCode === "EV_REJECT_RISK"
  ) {
    return { classification: "REAL_EV_REJECTION", replayReasonCode: replay.reasonCode };
  }
  return { classification: "OTHER", replayReasonCode: replay.reasonCode };
}

export function isLegacyEvAnomaly(row: EvAnomalyReplayRow): boolean {
  return (row.reasonCode === "EV_REJECT" || row.verdict === "REJECTED") && row.expectedValue >= row.threshold;
}
