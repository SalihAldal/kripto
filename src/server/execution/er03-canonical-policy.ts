import type { TradingMode } from "@/src/server/execution/types";
import type { StrategyActivationMode } from "@/src/server/execution/p7-paper-strategy-contract";

export type CanonicalAdmissionVerdict = "ENTER" | "WAIT" | "REJECT";

const WAIT_BLOCKER_CODES = new Set([
  "NO_ELIGIBLE_STRATEGY",
  "STRATEGY_CONFLICT",
  "ROUTER_SHADOW_ONLY",
]);

const BLOCKER_PRIORITY: Record<string, number> = {
  INSUFFICIENT_DATA: 10,
  STALE_DATA: 20,
  INVALID_FEATURES: 30,
  NO_ELIGIBLE_STRATEGY: 40,
  STRATEGY_CONFLICT: 50,
  QUALITY_GATE_REJECT: 60,
  ORCHESTRATION_BLOCK: 70,
  ORCHESTRATION_SUPPRESS: 80,
  ADAPTIVE_GATE_REJECT: 90,
  SMART_ENTRY_REJECT: 100,
};

export function sortCanonicalBlockers<T extends { code: string }>(blockers: T[]): T[] {
  return [...blockers].sort((a, b) => {
    const pa = BLOCKER_PRIORITY[a.code] ?? 1_000;
    const pb = BLOCKER_PRIORITY[b.code] ?? 1_000;
    if (pa === pb) return a.code.localeCompare(b.code);
    return pa - pb;
  });
}

export function resolveCanonicalAdmissionVerdict(blockerCodes: string[]): CanonicalAdmissionVerdict {
  if (blockerCodes.length === 0) return "ENTER";
  return WAIT_BLOCKER_CODES.has(blockerCodes[0] ?? "") ? "WAIT" : "REJECT";
}

export function resolveExecutionAuthorization(input: {
  mode: TradingMode;
  strategyActivation: StrategyActivationMode;
}): "PAPER_ELIGIBLE" | "SHADOW_ONLY" | "LIVE_DISABLED" {
  if (input.mode !== "paper") return "LIVE_DISABLED";
  return input.strategyActivation === "PAPER_ELIGIBLE" ? "PAPER_ELIGIBLE" : "SHADOW_ONLY";
}
