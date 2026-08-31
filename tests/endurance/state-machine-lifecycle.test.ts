import { describe, expect, it } from "vitest";
import {
  assessRoundProgressState,
  shouldBlockRecoveryRestart,
} from "@/src/server/execution/round-progress-state.service";
import { isBlockingAiDecision } from "@/src/server/execution/ai-execution-gate.service";
import { recoverRoundRegistryFromRuns } from "@/src/server/execution/round-registry.service";
import { resetRoundRegistryForTests } from "@/src/server/execution/round-registry.service";

const TERMINAL_STEPS = ["ROUND_COMPLETED", "ROUND_FAILED", "TIMEOUT"];

describe("long-run state machine lifecycle", () => {
  it("allows RUNNING → terminal → next round progression semantics", () => {
    const steps = ["ROUND_CREATED", "SCANNING", "AI_ANALYSIS", "ROUND_FAILED"];
    for (const step of steps) {
      const assessment = assessRoundProgressState({
        runtime: {
          step: step as "SCANNING",
          message: step,
          coarseState: "tariyor",
          candidatesProcessed: 1,
          retryCount: 0,
          selectionAttempt: 1,
          roundProgressPct: 10,
          elapsedMs: 60_000,
          selectionBudgetMs: 1_200_000,
          heartbeatAt: new Date().toISOString(),
          lastProgressAt: new Date().toISOString(),
          timeline: [],
        },
        selectionStartedAt: Date.now() - 60_000,
      });
      if (step === "ROUND_FAILED") {
        expect(assessment.progressState).toBe("TERMINALIZING");
      } else {
        expect(assessment.progressState).not.toBe("STALLED");
      }
    }
  });

  it("blocks illegal NO_TRADE → execution path at decision layer", () => {
    expect(isBlockingAiDecision("NO_TRADE")).toBe(true);
    expect(isBlockingAiDecision("REJECT")).toBe(true);
    expect(isBlockingAiDecision("WAIT")).toBe(true);
  });

  it("registry recovery consolidates duplicate in-progress runs", () => {
    resetRoundRegistryForTests();
    const now = new Date();
    const duplicates: string[] = [];
    const report = recoverRoundRegistryFromRuns({
      jobId: "job-sm",
      ownerId: "owner-sm",
      inProgressStates: ["tariyor", "coin_secildi"],
      runs: [
        { id: "run-old", roundNo: 18, state: "tariyor", startedAt: new Date(now.getTime() - 60_000) },
        { id: "run-new", roundNo: 18, state: "tariyor", startedAt: now },
        { id: "run-17", roundNo: 17, state: "tur_basarisiz", startedAt: now, endedAt: now },
      ],
      onDuplicateRun: async (runId) => {
        duplicates.push(runId);
      },
    });
    expect(report.duplicatesConsolidated).toBe(1);
    expect(duplicates).toEqual(["run-old"]);
    expect(report.rebuilt).toBe(1);
  });

  it("healthy AI_ACTIVE blocks recovery restart (no false stall restart)", () => {
    const assessment = assessRoundProgressState({
      runtime: {
        step: "AI_ANALYSIS",
        message: "long batch",
        coarseState: "tariyor",
        candidatesProcessed: 8,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 20,
        elapsedMs: 180_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        lastMeaningfulProgressAt: new Date().toISOString(),
        timeline: [],
        aiProcessed: 8,
        aiTotal: 80,
        intraRoundPct: 15,
      },
      selectionStartedAt: Date.now() - 180_000,
    });
    expect(shouldBlockRecoveryRestart(assessment)).toBe(true);
  });

  it.each(TERMINAL_STEPS)("terminal step %s is TERMINALIZING not ACTIVE", (step) => {
    const assessment = assessRoundProgressState({
      runtime: {
        step: step as "ROUND_FAILED",
        message: step,
        coarseState: "tur_basarisiz",
        candidatesProcessed: 0,
        retryCount: 0,
        selectionAttempt: 1,
        roundProgressPct: 100,
        elapsedMs: 300_000,
        selectionBudgetMs: 1_200_000,
        heartbeatAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        timeline: [],
      },
      selectionStartedAt: Date.now() - 300_000,
    });
    expect(assessment.progressState).toBe("TERMINALIZING");
  });
});
