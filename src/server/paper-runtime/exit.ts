import type { ExitReason, PaperPosition } from "@/src/server/paper-runtime/types";

export const EXIT_PRIORITY: ExitReason[] = [
  "EMERGENCY",
  "HARD_STOP",
  "RISK_EXIT",
  "TAKE_PROFIT",
  "PARTIAL_TP",
  "MOMENTUM_EXIT",
  "TRAILING",
  "TIME_EXIT",
];

export function pickExit(reasons: ExitReason[]): ExitReason | null {
  return EXIT_PRIORITY.find((reason) => reasons.includes(reason)) ?? null;
}

export function evaluateExits(input: {
  position: PaperPosition;
  bid: number;
  now: number;
  timeExitMs: number;
  minProgressPct: number;
  trailPct: number;
  partialTpPct?: number;
  flowCollapsed?: boolean;
  emergency?: boolean;
  riskHalt?: boolean;
}): ExitReason[] {
  const reasons: ExitReason[] = [];
  const pos = input.position;
  if (pos.state !== "OPEN" && pos.state !== "REDUCING") return reasons;
  if (input.emergency) reasons.push("EMERGENCY");
  if (input.riskHalt) reasons.push("RISK_EXIT");
  if (input.bid <= pos.stopPrice) reasons.push("HARD_STOP");
  if (input.bid >= pos.takeProfitPrice) reasons.push("TAKE_PROFIT");
  const progress = ((input.bid - pos.avgEntry) / pos.avgEntry) * 100;
  if (input.partialTpPct != null && pos.state === "OPEN" && progress >= input.partialTpPct && input.bid < pos.takeProfitPrice) {
    reasons.push("PARTIAL_TP");
  }
  const trailStop = pos.highSinceEntry * (1 - input.trailPct / 100);
  if (pos.highSinceEntry > pos.avgEntry * 1.004 && input.bid <= trailStop) reasons.push("TRAILING");
  if (input.flowCollapsed) reasons.push("MOMENTUM_EXIT");
  const held = input.now - pos.openedAt;
  if (held >= input.timeExitMs && progress < input.minProgressPct) reasons.push("TIME_EXIT");
  return reasons;
}

export function claimExit(position: PaperPosition, reason: ExitReason) {
  if (position.exitLock) return false;
  position.exitLock = true;
  position.exitReason = reason;
  position.state = reason === "PARTIAL_TP" ? "REDUCING" : "CLOSING";
  return true;
}
