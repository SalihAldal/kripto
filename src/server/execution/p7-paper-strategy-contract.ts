import type { TradingMode } from "@/src/server/execution/types";
import { resolveTerminalEvidence } from "@/src/server/forensics/er01-telemetry-verdict";

export const P7_TERMINAL_REASON_CODES = [
  "UNSUPPORTED_REGIME",
  "NO_ELIGIBLE_STRATEGY",
  "STRATEGY_NO_SIGNAL",
  "STRATEGY_CONFLICT",
  "ROUTER_SHADOW_ONLY",
  "FEE_NOT_VIABLE",
  "MINIMUM_MOVE_NOT_MET",
  "SPREAD_TOO_HIGH",
  "SLIPPAGE_TOO_HIGH",
  "RISK_REJECTED",
  "EXPOSURE_LIMIT",
  "LOSS_CAP",
  "STALE_DATA",
  "INSUFFICIENT_DATA",
  "ENTRY_CONTRACT_NOT_MET",
  "EXECUTION_NOT_REACHED",
  "INTERNAL_ERROR",
] as const;

export type P7TerminalReasonCode = (typeof P7_TERMINAL_REASON_CODES)[number];

export type P7TerminalDecision = "ENTER" | "WAIT" | "REJECT";

export type StrategyActivationMode = "SHADOW_ONLY" | "PAPER_ELIGIBLE" | "LIVE_DISABLED";

export type StrategyStatus = "SHADOW_ONLY" | "PAPER_EXPERIMENT" | "OFFLINE_CANDIDATE" | "LIVE_NOT_APPROVED" | "NOT_SUPPORTED";

export type P7RoundTerminalStatus =
  | "COMPLETED_ENTER"
  | "COMPLETED_WAIT"
  | "COMPLETED_REJECT"
  | "COMPLETED_NO_CANDIDATE"
  | "FAILED_ENGINEERING"
  | "STOPPED_SAFETY"
  | "CANCELLED_USER";

export function resolveStrategyActivationMode(input: {
  executionMode: TradingMode;
  strategyStatus: StrategyStatus;
  liveTradingEnabled: boolean;
}): StrategyActivationMode {
  if (input.executionMode === "live") return "LIVE_DISABLED";
  if (input.executionMode !== "paper") return "SHADOW_ONLY";
  if (input.strategyStatus === "PAPER_EXPERIMENT" || input.strategyStatus === "OFFLINE_CANDIDATE") {
    return "PAPER_ELIGIBLE";
  }
  return "SHADOW_ONLY";
}

export function classifyTerminalReason(reason: string): {
  decision: P7TerminalDecision;
  reasonCode: P7TerminalReasonCode;
  secondary: P7TerminalReasonCode[];
} {
  const resolved = resolveTerminalEvidence({
    structured: null,
    legacyReason: reason,
    runState: null,
    hasCandidate: true,
    openedPosition: false,
    submittedOrder: false,
    fillCount: 0,
    executionFailed: false,
  });
  const toCode = (code: string | null): P7TerminalReasonCode => {
    if (!code) return "INTERNAL_ERROR";
    const upper = code.toUpperCase();
    if ((P7_TERMINAL_REASON_CODES as readonly string[]).includes(code)) {
      return code as P7TerminalReasonCode;
    }
    if (upper.includes("SPREAD")) return "SPREAD_TOO_HIGH";
    if (upper.includes("SLIPPAGE")) return "SLIPPAGE_TOO_HIGH";
    if (upper.includes("RISK")) return "RISK_REJECTED";
    if (upper.includes("FEE")) return "FEE_NOT_VIABLE";
    if (upper.includes("NO_ELIGIBLE_STRATEGY")) return "NO_ELIGIBLE_STRATEGY";
    if (upper.includes("STRATEGY_CONFLICT")) return "STRATEGY_CONFLICT";
    if (upper.includes("STALE")) return "STALE_DATA";
    if (upper.includes("INSUFFICIENT")) return "INSUFFICIENT_DATA";
    if (code === "LEGACY_REASON_NOT_RECORDED") return "INTERNAL_ERROR";
    if (code === "SELECTION_TIMEOUT") return "ENTRY_CONTRACT_NOT_MET";
    if (code === "NO_CANDIDATE_EXPECTED") return "ENTRY_CONTRACT_NOT_MET";
    return "INTERNAL_ERROR";
  };
  const first = toCode(resolved.firstBlocker);
  return {
    decision: resolved.decision ?? "WAIT",
    reasonCode: first,
    secondary: resolved.secondaryBlockers.map((x) => toCode(x)),
  };
}
