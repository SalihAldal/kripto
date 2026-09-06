import type { ExitPolicySnapshot } from "@/src/server/profitability/pr04-types";

export function evaluateTimeExit(input: {
  snapshot: ExitPolicySnapshot;
  timeAnchorMs: number;
  nowMs: number;
  progressPct: number;
  minProgressPct: number;
}) {
  const limit = input.snapshot.timeExitMs;
  if (limit == null || limit <= 0) return { triggered: false, reasonCode: "TIME_EXIT_DISABLED" };
  const elapsed = input.nowMs - input.timeAnchorMs;
  if (elapsed < limit) return { triggered: false, reasonCode: "TIME_NOT_ELAPSED" };
  if (input.progressPct >= input.minProgressPct) return { triggered: false, reasonCode: "PROGRESS_SUFFICIENT" };
  return { triggered: true, reasonCode: "TIME_EXIT_INSUFFICIENT_PROGRESS" };
}

export function resolveTimeAnchorMs(input: {
  snapshot: ExitPolicySnapshot;
  firstFillAtMs: number;
  positionOpenAtMs: number;
}) {
  return input.snapshot.timeReference === "POSITION_OPEN" ? input.positionOpenAtMs : input.firstFillAtMs;
}
