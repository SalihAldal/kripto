export type RoundTerminalClass = "NORMAL_TERMINAL" | "ABNORMAL_RUNTIME_TERMINAL";

const ABNORMAL_MARKERS = [
  "SELECTION_BUDGET_EXCEEDED",
  "BUDGET_EXPIRED",
  "ROUND_STALLED",
  "JOB_TIMEOUT",
  "ROUND_NOT_TERMINAL",
  "PERSIST_TIMEOUT",
  "DEPENDENCY_RETRY_BUDGET_EXHAUSTED",
  "AI_TIMEOUT_STALL",
  "CANCELLATION_RUNTIME",
  "SCHEDULER_RUNTIME_FAILURE",
  "WATCHDOG_TERMINATION",
  "TUR SECIM SURESI DOLDU",
  "SELECTION TIMEOUT",
  "NO PROGRESS WITHIN STALL THRESHOLD",
  "RUNTIME HEARTBEAT STALE",
  "RUNTIME PROGRESS STALE",
  "RECOVERY RESTART CURRENT STAGE",
  "PROGRESS_STALL_GRACE",
  "TIMEOUT",
];

const NORMAL_BUSINESS_MARKERS = [
  "AI_GATE_BLOCK: AI_VETO",
  "AI_VETO",
  "TDI_WAIT",
  "TDI_REJECT",
  "RISK_REJECT",
  "SIM_TIGHT_FILTER",
  "NO_CANDIDATES",
  "NO_CANDIDATE",
];

function normalize(value: string | null | undefined) {
  return String(value ?? "").toUpperCase().trim();
}

function containsAny(haystack: string, markers: string[]) {
  return markers.some((marker) => haystack.includes(marker));
}

export function classifyRoundTerminalReason(input: {
  reason?: string | null;
  reasonCode?: string | null;
  currentStage?: string | null;
}): { terminalClass: RoundTerminalClass; matchedRule: string } {
  const normalizedReason = normalize(input.reason);
  const normalizedReasonCode = normalize(input.reasonCode);
  const normalizedStage = normalize(input.currentStage);
  const combined = [normalizedReasonCode, normalizedReason, normalizedStage].filter(Boolean).join(" | ");

  if (containsAny(combined, ABNORMAL_MARKERS)) {
    return { terminalClass: "ABNORMAL_RUNTIME_TERMINAL", matchedRule: "ABNORMAL_MARKER_MATCH" };
  }
  if (containsAny(combined, NORMAL_BUSINESS_MARKERS)) {
    return { terminalClass: "NORMAL_TERMINAL", matchedRule: "NORMAL_BUSINESS_MARKER_MATCH" };
  }
  return { terminalClass: "NORMAL_TERMINAL", matchedRule: "DEFAULT_NORMAL_TERMINAL" };
}

export function isAbnormalRuntimeTerminal(input: {
  reason?: string | null;
  reasonCode?: string | null;
  currentStage?: string | null;
}) {
  return classifyRoundTerminalReason(input).terminalClass === "ABNORMAL_RUNTIME_TERMINAL";
}
