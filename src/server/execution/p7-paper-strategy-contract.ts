import type { TradingMode } from "@/src/server/execution/types";

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
  const upper = String(reason ?? "").toUpperCase();
  const codes: P7TerminalReasonCode[] = [];
  const add = (code: P7TerminalReasonCode) => {
    if (!codes.includes(code)) codes.push(code);
  };

  if (upper.includes("NO_CANDIDATE")) add("ENTRY_CONTRACT_NOT_MET");
  if (upper.includes("STALE")) add("STALE_DATA");
  if (upper.includes("INSUFFICIENT")) add("INSUFFICIENT_DATA");
  if (upper.includes("REGIME")) add("UNSUPPORTED_REGIME");
  if (upper.includes("NO_ELIGIBLE_STRATEGY")) add("NO_ELIGIBLE_STRATEGY");
  if (upper.includes("NO_SIGNAL")) add("STRATEGY_NO_SIGNAL");
  if (upper.includes("CONFLICT")) add("STRATEGY_CONFLICT");
  if (upper.includes("SHADOW_ONLY")) add("ROUTER_SHADOW_ONLY");
  if (upper.includes("FEE")) add("FEE_NOT_VIABLE");
  if (upper.includes("MINIMUM_MOVE")) add("MINIMUM_MOVE_NOT_MET");
  if (upper.includes("SPREAD")) add("SPREAD_TOO_HIGH");
  if (upper.includes("SLIPPAGE")) add("SLIPPAGE_TOO_HIGH");
  if (upper.includes("RISK")) add("RISK_REJECTED");
  if (upper.includes("EXPOSURE")) add("EXPOSURE_LIMIT");
  if (upper.includes("LOSS_CAP")) add("LOSS_CAP");
  if (upper.includes("EXECUTION")) add("EXECUTION_NOT_REACHED");
  if (upper.includes("ERROR") || upper.includes("FAILED")) add("INTERNAL_ERROR");

  const first = codes[0] ?? "ENTRY_CONTRACT_NOT_MET";
  const isWait = first === "STALE_DATA" || first === "INSUFFICIENT_DATA" || first === "ENTRY_CONTRACT_NOT_MET";
  return {
    decision: isWait ? "WAIT" : "REJECT",
    reasonCode: first,
    secondary: codes.slice(1),
  };
}
