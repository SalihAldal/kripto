import { logger } from "@/lib/logger";
import { resolveRoundWatchdogStaleMs } from "@/src/server/execution/cooperative-async.service";
import { recoverRoundRegistryFromRuns } from "@/src/server/execution/round-registry.service";
import { readRuntimeFromMetadata } from "@/src/server/execution/round-runtime.service";
import {
  assessRoundProgressState,
  mapProgressStateToRecoveryDecision,
  shouldBlockRecoveryRestart,
  type RoundProgressAssessment,
} from "@/src/server/execution/round-progress-state.service";
import {
  mapRecoveryToTerminalReason,
  recordRecoveryTelemetry,
} from "@/src/server/forensics/recovery-telemetry.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import type {
  JobHealthEvaluation,
  ProductionHealthSnapshot,
  RecoveryFailureKind,
  RecoveryHealthIssue,
  RecoveryPolicyDecision,
  SchedulerRecoveryDeps,
  SchedulerRecoveryResult,
} from "@/src/server/execution/scheduler-recovery.types";
import {
  getProcessOwnerId,
  getSchedulerLeaseSnapshot,
  getSchedulerRegistrySnapshot,
  hasLocalSchedulerLoop,
  isSchedulerLeaseLive,
  isSchedulerLeaseStale,
} from "@/src/server/execution/scheduler-ownership.service";
import {
  appendRecoveryAuditEvent,
  computeEscalationLevel,
  normalizeRecoveryWindow,
  pingDatabaseConnectivity,
  readRecoveryAuditTrail,
  readRecoveryState,
  readRecoveryStateFromMetadata,
  shouldStopDueToRecoveryLimits,
} from "@/src/server/repositories/scheduler-recovery-audit.repository";
import {
  auditAutoRoundIntegrity,
  shouldAcceptHeartbeatUpdate,
} from "@/src/server/repositories/auto-round-integrity.repository";
import {
  getAutoRoundJobById,
  listRunningAutoRoundJobs,
  loadSchedulerLease,
} from "@/src/server/repositories/auto-round.repository";

const IN_PROGRESS_STATES = ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"];
const RUNTIME_STALL_FAILURES = new Set<RecoveryFailureKind>([
  "RUNTIME_STALL",
  "HEARTBEAT_LOSS",
  "SCANNER_FAILURE",
  "AI_TIMEOUT",
  "DISCOVERY_TIMEOUT",
]);

let configuredDeps: SchedulerRecoveryDeps | null = null;
const recoveryQueues = new Map<string, Promise<SchedulerRecoveryResult>>();

export function configureSchedulerRecovery(deps: SchedulerRecoveryDeps) {
  configuredDeps = deps;
}

function requireDeps() {
  if (!configuredDeps) {
    throw new Error("Scheduler recovery dependencies are not configured");
  }
  return configuredDeps;
}

function buildProgressTelemetry(input: {
  assessment: RoundProgressAssessment;
  recoveryState: ReturnType<typeof normalizeRecoveryWindow>;
  activeRun?: { id: string; roundNo: number } | null;
  proposedAction?: string;
}) {
  const mapped = mapProgressStateToRecoveryDecision({
    assessment: input.assessment,
    proposedAction: input.proposedAction ?? "NO_ACTION",
  });
  return {
    roundId: input.activeRun ? String(input.activeRun.roundNo) : undefined,
    stage: String(input.assessment.evidence.step ?? "selection"),
    progressState: input.assessment.progressState,
    recoveryDecision: mapped.recoveryDecision,
    reasonCode: mapped.reasonCode,
    reasonDetail: input.assessment.reasonDetail,
    recoveryCount: input.recoveryState.recoveryCount,
    lastProgressAt: input.assessment.lastProgressAt,
    heartbeatAt: input.assessment.heartbeatAt,
    elapsedMs: input.assessment.elapsedMs,
    selectionBudgetMs: input.assessment.selectionBudgetMs,
    stallElapsedMs: input.assessment.stallElapsedMs,
    selectionBudgetRemainingMs: input.assessment.selectionBudgetRemainingMs,
  };
}

function recordProgressRecoveryTelemetry(input: {
  jobId: string;
  runId?: string;
  assessment: RoundProgressAssessment;
  recoveryState: ReturnType<typeof normalizeRecoveryWindow>;
  activeRun?: { id: string; roundNo: number } | null;
  proposedAction: string;
  failure?: RecoveryFailureKind;
  action?: string;
}) {
  const telemetry = buildProgressTelemetry({
    assessment: input.assessment,
    recoveryState: input.recoveryState,
    activeRun: input.activeRun,
    proposedAction: input.proposedAction,
  });
  recordRecoveryTelemetry({
    jobId: input.jobId,
    runId: input.runId,
    roundId: telemetry.roundId,
    stage: telemetry.stage,
    failure: input.failure,
    action: input.action,
    recoveryCount: telemetry.recoveryCount,
    escalationCount: input.recoveryState.escalationLevel,
    lastRecoveryReason: telemetry.reasonDetail,
    progressState: telemetry.progressState,
    recoveryDecision: telemetry.recoveryDecision,
    reasonCode: telemetry.reasonCode,
    reasonDetail: telemetry.reasonDetail,
    lastProgressAt: telemetry.lastProgressAt,
    heartbeatAt: telemetry.heartbeatAt,
    elapsedMs: telemetry.elapsedMs,
    selectionBudgetMs: telemetry.selectionBudgetMs,
    stallElapsedMs: telemetry.stallElapsedMs,
    selectionBudgetRemainingMs: telemetry.selectionBudgetRemainingMs,
  });
  return telemetry;
}

function scoreFromIssues(issues: RecoveryHealthIssue[]) {
  if (issues.some((row) => row.severity === "critical")) return 25;
  if (issues.some((row) => row.severity === "warn")) return 60;
  if (issues.length > 0) return 80;
  return 100;
}

function buildRoundOwnerId(processOwnerId: string) {
  return `${processOwnerId}:recovery`;
}

export async function evaluateJobHealth(jobId: string): Promise<JobHealthEvaluation | null> {
  const job = await getAutoRoundJobById(jobId);
  if (!job) return null;

  const issues: RecoveryHealthIssue[] = [];
  const dbLease = (await loadSchedulerLease(jobId)) ?? null;
  const localLease = getSchedulerLeaseSnapshot(jobId);
  const lease = localLease ?? dbLease;
  const hasLocalLoop = hasLocalSchedulerLoop(jobId);
  const hasLiveLease = isSchedulerLeaseLive(lease, getProcessOwnerId());
  const recoveryState = normalizeRecoveryWindow(readRecoveryStateFromMetadata(job.metadata));

  if (job.status === "RUNNING") {
    if (!hasLocalLoop && !hasLiveLease) {
      issues.push({
        component: "scheduler",
        failure: isSchedulerLeaseStale(lease) ? "SCHEDULER_LEASE_STALE" : "SCHEDULER_CRASH",
        severity: "critical",
        message: "Running job has no live scheduler loop or lease",
        evidence: { leaseState: lease?.state ?? null, leaseOwnerId: lease?.ownerId ?? null },
      });
    } else if (!hasLocalLoop && hasLiveLease && lease?.ownerId !== getProcessOwnerId()) {
      issues.push({
        component: "lease",
        failure: "LEASE_HELD_BY_PEER",
        severity: "info",
        message: "Scheduler lease owned by another process",
        evidence: { leaseOwnerId: lease.ownerId },
      });
    }
  }

  const activeRuns = (job.rounds ?? []).filter((run) => !run.endedAt && IN_PROGRESS_STATES.includes(run.state));
  const activeRun = activeRuns.sort((a, b) => b.roundNo - a.roundNo)[0] ?? null;
  const runtimeSnapshot = activeRun
    ? readRuntimeFromMetadata((activeRun.metadata as Record<string, unknown> | null) ?? null)
    : null;
  const progressAssessment = activeRun
    ? assessRoundProgressState({
        runtime: runtimeSnapshot,
        selectionBudgetMs: runtimeSnapshot?.selectionBudgetMs,
      })
    : null;

  if (activeRun) {
    const heartbeatAt = String(runtimeSnapshot?.heartbeatAt ?? "");
    const heartbeatStaleMs = resolveRoundWatchdogStaleMs();
    const step = String(runtimeSnapshot?.step ?? "");
    const progressBlocked = progressAssessment ? shouldBlockRecoveryRestart(progressAssessment) : false;

    if (heartbeatAt) {
      const ageMs = Date.now() - new Date(heartbeatAt).getTime();
      if (ageMs > heartbeatStaleMs && !progressBlocked) {
        issues.push({
          component: "heartbeat",
          failure: activeRun.state === "tariyor" ? "RUNTIME_STALL" : "HEARTBEAT_LOSS",
          severity: "warn",
          message: `Runtime heartbeat stale (${Math.floor(ageMs / 1000)}s)`,
          evidence: { runId: activeRun.id, roundNo: activeRun.roundNo, heartbeatAt, progressState: progressAssessment?.progressState },
        });
      }
    } else if (activeRun.state === "tariyor" && !progressBlocked) {
      issues.push({
        component: "runtime",
        failure: "RUNTIME_STALL",
        severity: "warn",
        message: "Active round missing runtime heartbeat",
        evidence: { runId: activeRun.id, roundNo: activeRun.roundNo, progressState: progressAssessment?.progressState },
      });
    }

    if (
      (step.includes("SCAN") || step.includes("DISCOVERY")) &&
      progressAssessment?.progressState === "STALLED"
    ) {
      issues.push({
        component: "scanner",
        failure: "DISCOVERY_TIMEOUT",
        severity: "warn",
        message: "Scanner/discovery stage appears stalled",
        evidence: { step, progressState: progressAssessment.progressState, stallElapsedMs: progressAssessment.stallElapsedMs },
      });
    }
    if ((step.includes("AI") || step.includes("CONSENSUS")) && progressAssessment?.progressState === "STALLED") {
      issues.push({
        component: "ai",
        failure: "AI_TIMEOUT",
        severity: "warn",
        message: "AI stage stalled without recent progress",
        evidence: { step, progressState: progressAssessment.progressState, stallElapsedMs: progressAssessment.stallElapsedMs },
      });
    }
  }

  const integrity = await auditAutoRoundIntegrity(jobId);
  if (integrity) {
    if (Object.keys(integrity.duplicateActiveRoundNos).length > 0) {
      issues.push({
        component: "registry",
        failure: "REGISTRY_INTEGRITY",
        severity: "critical",
        message: "Duplicate active logical rounds detected",
        evidence: integrity.duplicateActiveRoundNos,
      });
    }
    if (integrity.orphanActiveRunId) {
      issues.push({
        component: "round_ownership",
        failure: "REGISTRY_INTEGRITY",
        severity: "warn",
        message: "Job activeRunId points to non-active run",
        evidence: { activeRunId: integrity.activeRunId },
      });
    }
  }

  const db = await pingDatabaseConnectivity();
  if (!db.ok) {
    issues.push({
      component: "database",
      failure: "DATABASE_DISCONNECT",
      severity: "critical",
      message: db.error ?? "Database connectivity check failed",
    });
  }

  const limits = shouldStopDueToRecoveryLimits(recoveryState, "SCHEDULER_CRASH");
  const canRecover =
    job.status === "RUNNING" &&
    !limits.stop &&
    issues.every((row) => row.failure !== "LEASE_HELD_BY_PEER");

  return {
    jobId,
    jobStatus: job.status,
    issues,
    score: scoreFromIssues(issues),
    canRecover,
    hasLocalLoop,
    hasLiveLease,
    leaseOwnerId: lease?.ownerId ?? null,
    activeRunId: activeRun?.id ?? job.activeRunId ?? null,
    activeRunRoundNo: activeRun?.roundNo ?? null,
    progressAssessment,
    progressTelemetry: progressAssessment
      ? buildProgressTelemetry({
          assessment: progressAssessment,
          recoveryState: {
            ...recoveryState,
            escalationLevel: computeEscalationLevel(recoveryState),
          },
          activeRun: activeRun ? { id: activeRun.id, roundNo: activeRun.roundNo } : null,
        })
      : null,
    recoveryState: {
      ...recoveryState,
      escalationLevel: computeEscalationLevel(recoveryState),
    },
  };
}

export function decideRecoveryPolicy(input: {
  issues: RecoveryHealthIssue[];
  recoveryState: ReturnType<typeof normalizeRecoveryWindow>;
  hasLocalLoop: boolean;
  hasLiveLease: boolean;
  leaseOwnerId: string | null;
  progressAssessment?: RoundProgressAssessment | null;
  activeRunId?: string | null;
  activeRunRoundNo?: number | null;
  jobId?: string;
}): RecoveryPolicyDecision {
  const escalationLevel = computeEscalationLevel(input.recoveryState);
  const primary =
    input.issues.find((row) => row.severity === "critical") ??
    input.issues.find((row) => row.severity === "warn") ??
    null;

  if (input.progressAssessment && primary && RUNTIME_STALL_FAILURES.has(primary.failure)) {
    if (shouldBlockRecoveryRestart(input.progressAssessment)) {
      if (input.jobId) {
        recordProgressRecoveryTelemetry({
          jobId: input.jobId,
          runId: input.activeRunId ?? undefined,
          assessment: input.progressAssessment,
          recoveryState: input.recoveryState,
          activeRun:
            input.activeRunId && input.activeRunRoundNo
              ? { id: input.activeRunId, roundNo: input.activeRunRoundNo }
              : null,
          proposedAction: "NO_ACTION",
          failure: primary.failure,
          action: "NO_ACTION",
        });
      }
      return {
        action: "NO_ACTION",
        reason: `${input.progressAssessment.progressState}: ${input.progressAssessment.reasonDetail}`,
        failure: primary.failure,
        component: primary.component,
        escalationLevel,
        safeResume: true,
      };
    }
  }

  if (!primary) {
    return {
      action: "NO_ACTION",
      reason: "No recoverable issue detected",
      failure: "SCHEDULER_CRASH",
      component: "recovery_manager",
      escalationLevel,
      safeResume: true,
    };
  }

  if (primary.failure === "LEASE_HELD_BY_PEER") {
    return {
      action: "NO_ACTION",
      reason: "Peer process owns scheduler lease",
      failure: primary.failure,
      component: primary.component,
      escalationLevel,
      safeResume: false,
    };
  }

  if (escalationLevel >= 5) {
    return {
      action: "STOP_JOB",
      reason: "Recovery escalation limit reached",
      failure: primary.failure,
      component: primary.component,
      escalationLevel,
      safeResume: false,
    };
  }

  if (primary.failure === "REGISTRY_INTEGRITY") {
    return {
      action: escalationLevel >= 3 ? "RESTART_CURRENT_ROUND" : "RECONCILE",
      reason: "Registry integrity issue requires reconciliation",
      failure: primary.failure,
      component: primary.component,
      escalationLevel,
      safeResume: true,
    };
  }

  if (primary.failure === "WAITING_RUN_OVERDUE") {
    return {
      action: "RECONCILE",
      reason: "Reconcile overdue waiting runs",
      failure: primary.failure,
      component: "runtime",
      escalationLevel,
      safeResume: true,
    };
  }

  if (
    primary.failure === "RUNTIME_STALL" ||
    primary.failure === "HEARTBEAT_LOSS" ||
    primary.failure === "SCANNER_FAILURE" ||
    primary.failure === "AI_TIMEOUT" ||
    primary.failure === "DISCOVERY_TIMEOUT"
  ) {
    if (escalationLevel >= 4) {
      return {
        action: "FAIL_CURRENT_ROUND",
        reason: "Repeated runtime failures — fail current round",
        failure: primary.failure,
        component: primary.component,
        escalationLevel,
        safeResume: false,
      };
    }
    if (escalationLevel >= 2) {
      return {
        action: "RESTART_CURRENT_STAGE",
        reason: "Restart current stage after repeated stalls",
        failure: primary.failure,
        component: primary.component,
        escalationLevel,
        safeResume: true,
      };
    }
    return {
      action: "RETRY",
      reason: "Retry current stage with existing repository progress",
      failure: primary.failure,
      component: primary.component,
      escalationLevel,
      safeResume: true,
    };
  }

  if (
    primary.failure === "SCHEDULER_CRASH" ||
    primary.failure === "SCHEDULER_LEASE_STALE" ||
    primary.failure === "WORKER_CRASH"
  ) {
    if (input.hasLocalLoop) {
      return {
        action: "NO_ACTION",
        reason: "Local scheduler loop already active",
        failure: primary.failure,
        component: "scheduler",
        escalationLevel,
        safeResume: true,
      };
    }
    return {
      action: "RESUME",
      reason: "Respawn scheduler and resume from repository evidence",
      failure: primary.failure,
      component: "scheduler",
      escalationLevel,
      safeResume: true,
    };
  }

  if (primary.failure === "DATABASE_DISCONNECT" || primary.failure === "NETWORK_INTERRUPTION") {
    return {
      action: "RETRY",
      reason: "Retry after connectivity restoration",
      failure: primary.failure,
      component: primary.component,
      escalationLevel,
      safeResume: true,
    };
  }

  return {
    action: "RESUME",
    reason: "Default safe resume",
    failure: primary.failure,
    component: primary.component,
    escalationLevel,
    safeResume: true,
  };
}

async function applyRecoveryAction(input: {
  jobId: string;
  decision: RecoveryPolicyDecision;
  evaluation: JobHealthEvaluation;
}): Promise<{ result: SchedulerRecoveryResult["result"]; spawn?: SchedulerRecoveryResult["spawn"]; message?: string }> {
  const deps = requireDeps();
  const job = await getAutoRoundJobById(input.jobId);
  if (!job) return { result: "failure", message: "Job missing" };

  switch (input.decision.action) {
    case "NO_ACTION":
      return { result: "skipped", message: input.decision.reason };
    case "RECONCILE": {
      await deps.reconcileStaleWaitingRuns(input.jobId);
      deps.recoverRoundRegistry({
        jobId: input.jobId,
        ownerId: buildRoundOwnerId(getProcessOwnerId()),
        runs: (job.rounds ?? []).map((run) => ({
          id: run.id,
          roundNo: run.roundNo,
          state: run.state,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          metadata: run.metadata,
        })),
      });
      return { result: "success", message: "Registry reconciled" };
    }
    case "RESTART_CURRENT_STAGE": {
      if (input.evaluation.progressAssessment) {
        recordProgressRecoveryTelemetry({
          jobId: input.jobId,
          runId: input.evaluation.activeRunId ?? undefined,
          assessment: input.evaluation.progressAssessment,
          recoveryState: input.evaluation.recoveryState,
          activeRun:
            input.evaluation.activeRunId && input.evaluation.activeRunRoundNo
              ? { id: input.evaluation.activeRunId, roundNo: input.evaluation.activeRunRoundNo }
              : null,
          proposedAction: input.decision.action,
          failure: input.decision.failure,
          action: input.decision.action,
        });
      }
      deps.cancelRoundSelection(input.jobId);
      if (!input.evaluation.hasLocalLoop) {
        const spawn = await deps.spawnScheduler(input.jobId);
        return { result: spawn.action === "rejected" ? "partial" : "success", spawn, message: "Selection restarted" };
      }
      return { result: "success", message: "Selection cancellation signaled" };
    }
    case "RESUME":
    case "RETRY":
    case "CONTINUE_NEXT_ROUND": {
      deps.recoverRoundRegistry({
        jobId: input.jobId,
        ownerId: buildRoundOwnerId(getProcessOwnerId()),
        runs: (job.rounds ?? []).map((run) => ({
          id: run.id,
          roundNo: run.roundNo,
          state: run.state,
          startedAt: run.startedAt,
          endedAt: run.endedAt,
          metadata: run.metadata,
        })),
      });
      await deps.reconcileStaleWaitingRuns(input.jobId);
      if (input.evaluation.hasLocalLoop) {
        return { result: "skipped", message: "Scheduler already running locally" };
      }
      const spawn = await deps.spawnScheduler(input.jobId);
      return {
        result: spawn.action === "spawned" || spawn.action === "attached" ? "success" : "partial",
        spawn,
        message: spawn.reason ?? spawn.action,
      };
    }
    case "RESTART_CURRENT_ROUND":
    case "FAIL_CURRENT_ROUND": {
      await deps.failActiveRound?.(input.jobId, input.decision.reason).catch(() => null);
      recordRecoveryTelemetry({
        jobId: input.jobId,
        runId: input.evaluation.activeRunId ?? undefined,
        failure: input.decision.failure,
        action: input.decision.action,
        recoveryCount: input.evaluation.recoveryState.recoveryCount,
        recoveryFailure: input.evaluation.recoveryState.recoveryFailure,
        escalationCount: input.decision.escalationLevel,
        lastRecoveryReason: input.decision.reason,
        recoveryStage: job.currentRound ? String(job.currentRound) : undefined,
        ...mapRecoveryToTerminalReason({
          action: input.decision.action,
          escalationLevel: input.decision.escalationLevel,
          failure: input.decision.failure,
        }) ?? {},
      });
      return { result: "success", message: input.decision.reason };
    }
    case "STOP_JOB":
      await deps.failActiveRound?.(input.jobId, STALL_ERROR_CODES.RECOVERY_EXHAUSTED).catch(() => null);
      await deps.stopJob(input.jobId, input.decision.reason);
      recordRecoveryTelemetry({
        jobId: input.jobId,
        runId: input.evaluation.activeRunId ?? undefined,
        failure: input.decision.failure,
        action: input.decision.action,
        recoveryCount: input.evaluation.recoveryState.recoveryCount,
        recoveryFailure: input.evaluation.recoveryState.recoveryFailure,
        escalationCount: input.decision.escalationLevel,
        lastRecoveryReason: input.decision.reason,
        recoveryStage: job.currentRound ? String(job.currentRound) : undefined,
        terminalState: "STOPPED",
        terminalReason: STALL_ERROR_CODES.RECOVERY_EXHAUSTED,
      });
      return { result: "success", message: "Job stopped by recovery policy" };
    default:
      return { result: "skipped", message: "Unhandled action" };
  }
}

export async function executeSchedulerRecovery(input: {
  jobId: string;
  trigger: SchedulerRecoveryResult["auditEvent"]["trigger"];
  operator?: SchedulerRecoveryResult["auditEvent"]["operator"];
  force?: boolean;
}): Promise<SchedulerRecoveryResult> {
  const previous = recoveryQueues.get(input.jobId);
  if (previous) return previous;

  const task = (async () => {
    const started = Date.now();
    const operator = input.operator ?? "automatic";
    const evaluation = await evaluateJobHealth(input.jobId);
    if (!evaluation) {
      throw new Error(`Job not found: ${input.jobId}`);
    }

    const decision = decideRecoveryPolicy({
      issues: evaluation.issues,
      recoveryState: evaluation.recoveryState,
      hasLocalLoop: evaluation.hasLocalLoop,
      hasLiveLease: evaluation.hasLiveLease,
      leaseOwnerId: evaluation.leaseOwnerId,
      progressAssessment: evaluation.progressAssessment ?? null,
      activeRunId: evaluation.activeRunId,
      activeRunRoundNo: evaluation.activeRunRoundNo ?? null,
      jobId: input.jobId,
    });

    if (!input.force && decision.action === "NO_ACTION") {
      const audit = await appendRecoveryAuditEvent({
        jobId: input.jobId,
        event: {
          jobId: input.jobId,
          component: decision.component,
          failure: decision.failure,
          decision,
          action: decision.action,
          result: "skipped",
          durationMs: Date.now() - started,
          operator,
          trigger: input.trigger,
          message: decision.reason,
        },
      });
      return {
        jobId: input.jobId,
        action: decision.action,
        result: "skipped" as const,
        decision,
        auditEvent: audit?.event ?? {
          id: "skipped",
          timestamp: new Date().toISOString(),
          jobId: input.jobId,
          component: decision.component,
          failure: decision.failure,
          decision,
          action: decision.action,
          result: "skipped",
          durationMs: Date.now() - started,
          operator,
          trigger: input.trigger,
        },
        skipped: true,
        reason: decision.reason,
      };
    }

    if (!evaluation.canRecover && !input.force && decision.action !== "NO_ACTION" && decision.action !== "RECONCILE") {
      const audit = await appendRecoveryAuditEvent({
        jobId: input.jobId,
        event: {
          jobId: input.jobId,
          component: decision.component,
          failure: decision.failure,
          decision,
          action: "NO_ACTION",
          result: "skipped",
          durationMs: Date.now() - started,
          operator,
          trigger: input.trigger,
          message: "Recovery blocked by policy limits or peer lease",
        },
      });
      return {
        jobId: input.jobId,
        action: "NO_ACTION",
        result: "skipped",
        decision,
        auditEvent: audit!.event,
        skipped: true,
        reason: "Recovery blocked",
      };
    }

    let applied: Awaited<ReturnType<typeof applyRecoveryAction>>;
    try {
      applied = await applyRecoveryAction({ jobId: input.jobId, decision, evaluation });
    } catch (error) {
      logger.error({ jobId: input.jobId, error: (error as Error).message }, "Scheduler recovery failed");
      const audit = await appendRecoveryAuditEvent({
        jobId: input.jobId,
        event: {
          jobId: input.jobId,
          component: decision.component,
          failure: decision.failure,
          decision,
          action: decision.action,
          result: "failure",
          durationMs: Date.now() - started,
          operator,
          trigger: input.trigger,
          message: (error as Error).message,
        },
      });
      return {
        jobId: input.jobId,
        action: decision.action,
        result: "failure",
        decision,
        auditEvent: audit!.event,
        reason: (error as Error).message,
      };
    }

    const audit = await appendRecoveryAuditEvent({
      jobId: input.jobId,
      event: {
        jobId: input.jobId,
        component: decision.component,
        failure: decision.failure,
        decision,
        action: decision.action,
        result: applied.result,
        durationMs: Date.now() - started,
        operator,
        trigger: input.trigger,
        message: applied.message,
        evidence: {
          spawnAction: applied.spawn?.action,
          safeResume: decision.safeResume,
          issueCount: evaluation.issues.length,
        },
      },
    });

    return {
      jobId: input.jobId,
      action: decision.action,
      result: applied.result,
      decision,
      spawn: applied.spawn,
      auditEvent: audit!.event,
      reason: applied.message,
    };
  })();

  recoveryQueues.set(input.jobId, task);
  try {
    return await task;
  } finally {
    if (recoveryQueues.get(input.jobId) === task) {
      recoveryQueues.delete(input.jobId);
    }
  }
}

export async function executeSchedulerRecoveryForRunningJobs(input?: {
  trigger?: SchedulerRecoveryResult["auditEvent"]["trigger"];
  limit?: number;
}) {
  const jobs = await listRunningAutoRoundJobs(input?.limit ?? 20);
  const results: SchedulerRecoveryResult[] = [];
  for (const job of jobs) {
    results.push(
      await executeSchedulerRecovery({
        jobId: job.id,
        trigger: input?.trigger ?? "startup",
        operator: "automatic",
      }),
    );
  }
  return results;
}

export async function getProductionHealthSnapshot(userId?: string): Promise<ProductionHealthSnapshot> {
  const jobs = userId
    ? (await listRunningAutoRoundJobs(20)).filter((row) => row.userId === userId)
    : await listRunningAutoRoundJobs(20);

  const evaluations = (
    await Promise.all(jobs.map((job) => evaluateJobHealth(job.id)))
  ).filter(Boolean) as JobHealthEvaluation[];

  const avg = (values: number[]) =>
    values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 100;

  const componentScore = (component: RecoveryHealthIssue["component"]) => {
    const relevant = evaluations.flatMap((row) => row.issues.filter((issue) => issue.component === component));
    return scoreFromIssues(relevant);
  };

  const db = await pingDatabaseConnectivity();
  const watchdogModule = await import("@/src/server/execution/scheduler-watchdog.service");
  const watchdogSnapshot = watchdogModule.getWatchdogRegistrySnapshot();

  const schedulerHealth = avg(evaluations.map((row) => (row.hasLocalLoop || row.hasLiveLease ? 100 : row.score)));
  const runtimeHealth = componentScore("runtime");
  const recoveryHealth = avg(
    evaluations.map((row) => Math.max(0, 100 - row.recoveryState.escalationLevel * 15)),
  );
  const watchdogHealth = watchdogSnapshot.activeCount > 0 ? 100 : evaluations.length > 0 ? 70 : 100;

  const overallScore = Math.round(
    (schedulerHealth +
      runtimeHealth +
      recoveryHealth +
      watchdogHealth +
      componentScore("registry") +
      componentScore("heartbeat") +
      (db.ok ? 100 : 0)) /
      7,
  );

  return {
    generatedAt: new Date().toISOString(),
    overallScore,
    schedulerHealth,
    runtimeHealth,
    recoveryHealth,
    watchdogHealth,
    scannerHealth: componentScore("scanner"),
    aiHealth: componentScore("ai"),
    databaseHealth: db.ok ? 100 : 0,
    ownershipHealth: componentScore("round_ownership"),
    heartbeatHealth: componentScore("heartbeat"),
    leaseHealth: componentScore("lease"),
    registryHealth: componentScore("registry"),
    jobs: evaluations,
    watchdog: watchdogSnapshot,
    recoveryManager: {
      processOwnerId: getProcessOwnerId(),
      pendingRecoveries: recoveryQueues.size,
    },
  };
}

export async function getRecoveryTimeline(jobId: string, limit = 50) {
  return readRecoveryAuditTrail(jobId, limit);
}

export async function performSelfHealingCheck(jobId: string) {
  const evaluation = await evaluateJobHealth(jobId);
  if (!evaluation) return null;
  if (evaluation.issues.length === 0) {
    return { healed: true, action: "NO_ACTION" as const, evaluation };
  }
  const result = await executeSchedulerRecovery({
    jobId,
    trigger: "watchdog",
    operator: "automatic",
  });
  return { healed: result.result === "success", result, evaluation };
}

export function isSafeResumeHeartbeat(current?: string, next?: string) {
  return shouldAcceptHeartbeatUpdate(current, next);
}

export async function getRecoveryStateForJob(jobId: string) {
  return readRecoveryState(jobId);
}

export { recoveryQueues };
