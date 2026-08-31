import { describe, expect, it } from "vitest";
import {
  assessRoundProgressState,
  shouldBlockRecoveryRestart,
} from "@/src/server/execution/round-progress-state.service";
import { RoundRuntimeController } from "@/src/server/execution/round-runtime.service";

describe("final round liveness safeguards", () => {
  it("marks stalled when heartbeat is fresh but meaningful progress exceeded grace", () => {
    const nowMs = Date.now();
    const assessment = assessRoundProgressState({
      nowMs,
      selectionBudgetMs: 1_200_000,
      selectionStartedAt: nowMs - 700_000,
      runtime: {
        step: "SCANNING",
        message: "heartbeat-only scanner loop",
        coarseState: "tariyor",
        candidatesProcessed: 40,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 35,
        elapsedMs: 700_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date(nowMs - 5_000).toISOString(),
        lastProgressAt: new Date(nowMs - 5_000).toISOString(),
        lastMeaningfulProgressAt: new Date(nowMs - 420_000).toISOString(),
        timeline: [],
      },
    });
    expect(assessment.progressState).toBe("STALLED");
    expect(assessment.reasonCode).toBe("MEANINGFUL_PROGRESS_STALE");
    expect(shouldBlockRecoveryRestart(assessment)).toBe(false);
  });

  it("keeps dependency-degraded state only inside grace window", () => {
    const nowMs = Date.now();
    const assessment = assessRoundProgressState({
      nowMs,
      selectionBudgetMs: 1_200_000,
      selectionStartedAt: nowMs - 300_000,
      runtime: {
        step: "SCANNING",
        message: "scanner retry in progress",
        coarseState: "tariyor",
        candidatesProcessed: 12,
        retryCount: 4,
        selectionAttempt: 1,
        roundProgressPct: 18,
        elapsedMs: 300_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date(nowMs - 10_000).toISOString(),
        lastProgressAt: new Date(nowMs - 10_000).toISOString(),
        lastMeaningfulProgressAt: new Date(nowMs - 210_000).toISOString(),
        marketDataFailures: 6,
        fallbackCount: 2,
        timeline: [],
      },
    });
    expect(["DEPENDENCY_DEGRADED", "WAITING_FOR_RETRY"]).toContain(assessment.progressState);
    expect(shouldBlockRecoveryRestart(assessment)).toBe(true);
  });

  it("forces stalled when retry loops outlive grace window", () => {
    const nowMs = Date.now();
    const assessment = assessRoundProgressState({
      nowMs,
      selectionBudgetMs: 1_200_000,
      selectionStartedAt: nowMs - 800_000,
      runtime: {
        step: "SCANNING",
        message: "scanner retry retry retry",
        coarseState: "tariyor",
        candidatesProcessed: 12,
        retryCount: 40,
        selectionAttempt: 1,
        roundProgressPct: 18,
        elapsedMs: 800_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date(nowMs - 8_000).toISOString(),
        lastProgressAt: new Date(nowMs - 8_000).toISOString(),
        lastMeaningfulProgressAt: new Date(nowMs - 420_000).toISOString(),
        marketDataFailures: 12,
        fallbackCount: 3,
        timeline: [],
      },
    });
    expect(assessment.progressState).toBe("STALLED");
    expect(shouldBlockRecoveryRestart(assessment)).toBe(false);
  });

  it("prevents reopening runtime after terminal step", async () => {
    const controller = new RoundRuntimeController(
      {
        jobId: "job-final-liveness",
        runId: "run-final-liveness",
        roundNo: 1,
        totalRounds: 2,
        selectionStartedAt: Date.now(),
        selectionBudgetMs: 120_000,
        selectionAttempt: 1,
        onPersist: async () => undefined,
      },
      3,
    );

    await controller.transition("SCANNING", "scanning started");
    await controller.failTimeout("forced timeout");
    const terminalBefore = controller.getSnapshot();

    await controller.transition("AI_ANALYSIS", "late worker update");
    controller.noteActivity("late heartbeat patch", { currentCandidate: "LATE" });
    const terminalAfter = controller.getSnapshot();

    expect(terminalAfter.step).toBe("TIMEOUT");
    expect(terminalAfter.message).toBe(terminalBefore.message);
    expect(terminalAfter.currentCandidate).toBe(terminalBefore.currentCandidate);
  });
});
