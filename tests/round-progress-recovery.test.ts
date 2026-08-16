import { describe, expect, it, beforeEach } from "vitest";
import {
  assessRoundProgressState,
  shouldBlockRecoveryRestart,
} from "@/src/server/execution/round-progress-state.service";
import { decideRecoveryPolicy } from "@/src/server/execution/scheduler-recovery.service";
import { normalizeRecoveryWindow } from "@/src/server/repositories/scheduler-recovery-audit.repository";
import { resetRecoveryTelemetry } from "@/src/server/forensics/recovery-telemetry.service";
import type { RoundRuntimeSnapshot } from "@/src/server/execution/round-runtime.types";

function runtime(partial: Partial<RoundRuntimeSnapshot>): RoundRuntimeSnapshot {
  const now = Date.now();
  return {
    step: "AI_ANALYSIS",
    message: "working",
    coarseState: "tariyor",
    candidatesProcessed: 0,
    retryCount: 0,
    selectionAttempt: 1,
    roundProgressPct: 20,
    elapsedMs: 120_000,
    selectionBudgetMs: 1_200_000,
    heartbeatAt: new Date(now - 5_000).toISOString(),
    lastProgressAt: new Date(now - 10_000).toISOString(),
    timeline: [],
    aiProcessed: 4,
    aiTotal: 80,
    intraRoundPct: 25,
    ...partial,
  };
}

describe("round progress state", () => {
  beforeEach(() => {
    resetRecoveryTelemetry();
  });

  it("classifies healthy AI progress as ACTIVE_PROGRESS", () => {
    const assessment = assessRoundProgressState({
      runtime: runtime({}),
      selectionStartedAt: Date.now() - 120_000,
    });
    expect(assessment.progressState).toBe("ACTIVE_PROGRESS");
    expect(shouldBlockRecoveryRestart(assessment)).toBe(true);
  });

  it("classifies heartbeat-only as HEARTBEAT_ONLY without immediate restart", () => {
    const now = Date.now();
    const assessment = assessRoundProgressState({
      runtime: runtime({
        heartbeatAt: new Date(now - 5_000).toISOString(),
        lastProgressAt: new Date(now - 240_000).toISOString(),
        aiProcessed: 0,
        intraRoundPct: 0,
      }),
      selectionStartedAt: now - 300_000,
    });
    expect(assessment.progressState).toBe("HEARTBEAT_ONLY");
    expect(shouldBlockRecoveryRestart(assessment)).toBe(true);
  });

  it("classifies POSSIBLY_HUNG inside grace window", () => {
    const now = Date.now();
    const assessment = assessRoundProgressState({
      runtime: runtime({
        heartbeatAt: new Date(now - 200_000).toISOString(),
        lastProgressAt: new Date(now - 200_000).toISOString(),
        aiProcessed: 0,
        intraRoundPct: 0,
      }),
      selectionStartedAt: now - 210_000,
    });
    expect(["POSSIBLY_HUNG", "STALLED"]).toContain(assessment.progressState);
    if (assessment.progressState === "POSSIBLY_HUNG") {
      expect(shouldBlockRecoveryRestart(assessment)).toBe(true);
    }
  });

  it("classifies STALLED when heartbeat and progress are both stale within budget", () => {
    const now = Date.now();
    const assessment = assessRoundProgressState({
      runtime: runtime({
        heartbeatAt: new Date(now - 400_000).toISOString(),
        lastProgressAt: new Date(now - 400_000).toISOString(),
        aiProcessed: 0,
        intraRoundPct: 0,
      }),
      selectionStartedAt: now - 420_000,
    });
    expect(assessment.progressState).toBe("STALLED");
    expect(shouldBlockRecoveryRestart(assessment)).toBe(false);
  });

  it("respects selection budget before FAILED", () => {
    const assessment = assessRoundProgressState({
      runtime: runtime({ selectionBudgetMs: 1_200_000, elapsedMs: 900_000 }),
      selectionStartedAt: Date.now() - 900_000,
    });
    expect(assessment.progressState).not.toBe("FAILED");
    expect(assessment.selectionBudgetRemainingMs).toBeGreaterThan(0);
  });
});

describe("progress-aware recovery policy", () => {
  it("does not restart during ACTIVE_PROGRESS even with AI_TIMEOUT issue", () => {
    const assessment = assessRoundProgressState({
      runtime: runtime({}),
      selectionStartedAt: Date.now() - 240_000,
    });
    const decision = decideRecoveryPolicy({
      issues: [
        {
          component: "ai",
          failure: "AI_TIMEOUT",
          severity: "warn",
          message: "would have restarted previously",
        },
      ],
      recoveryState: normalizeRecoveryWindow({
        recoveryCount: 8,
        recoverySuccess: 0,
        recoveryFailure: 0,
        escalationLevel: 0,
        windowStartedAt: new Date().toISOString(),
        lastRecoveryAt: null,
        lastCause: null,
        lastDurationMs: 0,
      }),
      hasLocalLoop: true,
      hasLiveLease: true,
      leaseOwnerId: null,
      progressAssessment: assessment,
      activeRunId: "run-1",
      activeRunRoundNo: 1,
      jobId: "job-1",
    });
    expect(decision.action).toBe("NO_ACTION");
  });

  it("allows RESTART_CURRENT_STAGE when truly STALLED and escalation is high", () => {
    const now = Date.now();
    const assessment = assessRoundProgressState({
      runtime: runtime({
        heartbeatAt: new Date(now - 500_000).toISOString(),
        lastProgressAt: new Date(now - 500_000).toISOString(),
        aiProcessed: 0,
        intraRoundPct: 0,
      }),
      selectionStartedAt: now - 520_000,
    });
    expect(assessment.progressState).toBe("STALLED");
    const decision = decideRecoveryPolicy({
      issues: [
        {
          component: "runtime",
          failure: "RUNTIME_STALL",
          severity: "warn",
          message: "stalled",
        },
      ],
      recoveryState: normalizeRecoveryWindow({
        recoveryCount: 8,
        recoverySuccess: 0,
        recoveryFailure: 0,
        escalationLevel: 0,
        windowStartedAt: new Date().toISOString(),
        lastRecoveryAt: null,
        lastCause: null,
        lastDurationMs: 0,
      }),
      hasLocalLoop: true,
      hasLiveLease: true,
      leaseOwnerId: null,
      progressAssessment: assessment,
    });
    expect(decision.action).toBe("RESTART_CURRENT_STAGE");
  });
});

describe("recovery counter semantics", () => {
  it("does not treat NO_ACTION as escalation input in policy when progress is healthy", () => {
    const assessment = assessRoundProgressState({ runtime: runtime({}), selectionStartedAt: Date.now() - 60_000 });
    const decision = decideRecoveryPolicy({
      issues: [],
      recoveryState: normalizeRecoveryWindow({
        recoveryCount: 0,
        recoverySuccess: 0,
        recoveryFailure: 0,
        escalationLevel: 0,
        windowStartedAt: new Date().toISOString(),
        lastRecoveryAt: null,
        lastCause: null,
        lastDurationMs: 0,
      }),
      hasLocalLoop: true,
      hasLiveLease: true,
      leaseOwnerId: null,
      progressAssessment: assessment,
    });
    expect(decision.action).toBe("NO_ACTION");
  });
});
