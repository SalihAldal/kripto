import { describe, expect, it } from "vitest";
import { assessRoundProgressState, shouldBlockRecoveryRestart } from "@/src/server/execution/round-progress-state.service";

describe("round progress state", () => {
  it("classifies degraded dependency as progress-safe", () => {
    const nowMs = Date.now();
    const assessment = assessRoundProgressState({
      nowMs,
      selectionBudgetMs: 1_200_000,
      selectionStartedAt: nowMs - 300_000,
      runtime: {
        step: "SCANNING",
        message: "scanner waiting for retries",
        coarseState: "tariyor",
        candidatesProcessed: 2,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 10,
        elapsedMs: 300_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date(nowMs - 20_000).toISOString(),
        lastProgressAt: new Date(nowMs - 240_000).toISOString(),
        marketDataFailures: 3,
        fallbackCount: 1,
        timeline: [],
      },
    });
    expect(["DEPENDENCY_DEGRADED", "WAITING_FOR_RETRY"]).toContain(assessment.progressState);
    expect(shouldBlockRecoveryRestart(assessment)).toBe(true);
  });

  it("marks stalled when no heartbeat and no progress", () => {
    const nowMs = Date.now();
    const assessment = assessRoundProgressState({
      nowMs,
      selectionBudgetMs: 1_200_000,
      selectionStartedAt: nowMs - 300_000,
      runtime: {
        step: "SCANNING",
        message: "no updates",
        coarseState: "tariyor",
        candidatesProcessed: 0,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 2,
        elapsedMs: 300_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date(nowMs - 300_000).toISOString(),
        lastProgressAt: new Date(nowMs - 300_000).toISOString(),
        timeline: [],
      },
    });
    expect(assessment.progressState).toBe("STALLED");
  });
});
