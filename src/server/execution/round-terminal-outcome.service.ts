import type { RoundRuntimeStep } from "@/src/server/execution/round-runtime.types";

export type RoundTerminalStage =
  | "selection"
  | "handoff"
  | "ai_evaluation"
  | "strategy"
  | "admission"
  | "execution"
  | "deadline"
  | "cancelled";

export type RoundTerminalOutcomeKind =
  | "no_eligible_candidate"
  | "handoff_invalid"
  | "ai_missing"
  | "ai_rejected"
  | "strategy_not_triggered"
  | "admission_rejected"
  | "execution_rejected"
  | "round_incomplete"
  | "completed_no_trade"
  | "completed_with_trade";

export type RoundTerminalOutcome = {
  stage: RoundTerminalStage;
  reasonCode: string;
  description: string;
  symbol?: string | null;
  candidateId?: string | null;
  outcome: RoundTerminalOutcomeKind;
  closeReason: string;
  runtimeStep: string;
};

export function classifyRoundTerminalOutcome(input: {
  reason: string;
  symbol?: string | null;
  candidateId?: string | null;
  incomplete?: boolean;
}): RoundTerminalOutcome {
  const reason = String(input.reason ?? "").trim();
  const upper = reason.toUpperCase();
  const symbol = input.symbol ?? null;
  const candidateId = input.candidateId ?? null;

  if (input.incomplete) {
    return {
      stage: "deadline",
      reasonCode: "ROUND_INCOMPLETE",
      description: reason || "Round interrupted before terminal completion",
      symbol,
      candidateId,
      outcome: "round_incomplete",
      closeReason: "ROUND_INCOMPLETE",
      runtimeStep: "INTERRUPTED",
    };
  }

  if (
    upper.includes("AI_HYDRATION") ||
    upper.includes("AI_CONSENSUS_MISSING") ||
    upper.includes("HANDOFF_AI") ||
    (upper.includes("NO TRADEABLE CANDIDATE") && symbol)
  ) {
    return {
      stage: "ai_evaluation",
      reasonCode: extractReasonCode(reason, "AI_EVALUATION_FAILED"),
      description: reason,
      symbol,
      candidateId,
      outcome: "ai_missing",
      closeReason: "AI_EVALUATION_INCOMPLETE",
      runtimeStep: "AI_EVALUATION",
    };
  }

  if (
    upper.includes("HANDOFF_") ||
    upper.includes("HANDOFF_CANDIDATE") ||
    upper.includes("HANDOFF_IDENTITY") ||
    upper.includes("HANDOFF_SYMBOL")
  ) {
    return {
      stage: "handoff",
      reasonCode: extractReasonCode(reason, "HANDOFF_INVALID"),
      description: reason,
      symbol,
      candidateId,
      outcome: "handoff_invalid",
      closeReason: "HANDOFF_REJECTED",
      runtimeStep: "HANDOFF_REJECTED",
    };
  }

  if (
    upper.includes("NO_ELIGIBLE_CANDIDATE") ||
    upper.includes("VALID_NO_CANDIDATE") ||
    (upper.includes("NO_CANDIDATE") && !symbol)
  ) {
    return {
      stage: "selection",
      reasonCode: "NO_ELIGIBLE_CANDIDATE",
      description: reason,
      symbol,
      candidateId,
      outcome: "no_eligible_candidate",
      closeReason: "NO_ELIGIBLE_CANDIDATE",
      runtimeStep: "NO_ELIGIBLE_CANDIDATE",
    };
  }

  if (upper.includes("AI_GATE") || upper.includes("LOW_CONFIDENCE") || upper.includes("NO_TRADE")) {
    return {
      stage: "ai_evaluation",
      reasonCode: extractReasonCode(reason, "AI_REJECTED"),
      description: reason,
      symbol,
      candidateId,
      outcome: "ai_rejected",
      closeReason: "AI_REJECTED",
      runtimeStep: "AI_REJECTED",
    };
  }

  if (upper.includes("STRATEGY") || upper.includes("ROUTER") || upper.includes("SIGNAL")) {
    return {
      stage: "strategy",
      reasonCode: extractReasonCode(reason, "STRATEGY_NOT_TRIGGERED"),
      description: reason,
      symbol,
      candidateId,
      outcome: "strategy_not_triggered",
      closeReason: "STRATEGY_NOT_TRIGGERED",
      runtimeStep: "STRATEGY_REJECTED",
    };
  }

  if (upper.includes("ADMISSION") || upper.includes("RISK_") || upper.includes("SPREAD")) {
    return {
      stage: "admission",
      reasonCode: extractReasonCode(reason, "ADMISSION_REJECTED"),
      description: reason,
      symbol,
      candidateId,
      outcome: "admission_rejected",
      closeReason: "ADMISSION_REJECTED",
      runtimeStep: "ADMISSION_REJECTED",
    };
  }

  return {
    stage: "execution",
    reasonCode: extractReasonCode(reason, "EXECUTION_REJECTED"),
    description: reason,
    symbol,
    candidateId,
    outcome: "execution_rejected",
    closeReason: "EXECUTION_REJECTED",
    runtimeStep: "EXECUTION_REJECTED",
  };
}

export function toRoundRuntimeStep(outcome: RoundTerminalOutcome): RoundRuntimeStep {
  switch (outcome.runtimeStep) {
    case "HANDOFF_REJECTED":
      return "CANDIDATE_REJECTED";
    case "AI_EVALUATION":
    case "AI_REJECTED":
      return "AI_ANALYSIS";
    case "STRATEGY_REJECTED":
    case "ADMISSION_REJECTED":
      return "CANDIDATE_REJECTED";
    case "EXECUTION_REJECTED":
      return "EXECUTING";
    case "INTERRUPTED":
      return "TIMEOUT";
    case "NO_ELIGIBLE_CANDIDATE":
    default:
      return "NO_CANDIDATE";
  }
}

export function formatTerminalReason(outcome: RoundTerminalOutcome): string {
  return `${outcome.stage}:${outcome.reasonCode}:${outcome.description}`;
}

export function resolveReportFailReason(input: {
  failReason?: string | null;
  terminalReason?: string | null;
  closeReason?: string | null;
  runtimeStep?: string | null;
  state?: string | null;
}): string {
  if (input.failReason && input.failReason.trim()) return input.failReason.trim();
  if (input.terminalReason && input.terminalReason.trim()) return input.terminalReason.trim();
  if (input.closeReason && input.closeReason.trim()) return input.closeReason.trim();
  if (input.state === "tariyor") return "ROUND_INCOMPLETE";
  if (input.runtimeStep && input.runtimeStep.trim()) return input.runtimeStep.trim();
  return "UNKNOWN";
}

function extractReasonCode(reason: string, fallback: string): string {
  const token = reason.split(":").find((part) => /^[A-Z][A-Z0-9_]+$/.test(part.trim()));
  return token?.trim() || fallback;
}
