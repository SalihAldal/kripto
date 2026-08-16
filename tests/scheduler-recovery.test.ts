import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  atomicStartSchedulerWatchdog,
  getWatchdogRegistrySnapshot,
  resetSchedulerWatchdogForTests,
  stopSchedulerWatchdog,
} from "@/src/server/execution/scheduler-watchdog.service";
import {
  configureSchedulerRecovery,
  decideRecoveryPolicy,
  evaluateJobHealth,
  executeSchedulerRecovery,
  recoveryQueues,
} from "@/src/server/execution/scheduler-recovery.service";
import { resetSchedulerOwnershipForTests } from "@/src/server/execution/scheduler-ownership.service";
import { normalizeRecoveryWindow } from "@/src/server/repositories/scheduler-recovery-audit.repository";

const jobs = new Map<string, Record<string, unknown>>();
const auditEvents: Array<Record<string, unknown>> = [];
let spawnCount = 0;

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ "?column?": 1 }]),
    autoRoundJob: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const prev = jobs.get(where.id) ?? { id: where.id, metadata: {} };
        const next = { ...prev, ...data, metadata: data.metadata ?? prev.metadata };
        jobs.set(where.id, next);
        return next;
      }),
    },
    autoRoundRun: {
      findMany: vi.fn(async ({ where }: { where: { jobId: string } }) => {
        const job = jobs.get(where.jobId);
        return (job?.rounds as unknown[]) ?? [];
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        autoRoundJob: {
          findUnique: async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null,
          update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const prev = jobs.get(where.id) ?? { id: where.id, metadata: {} };
            const next = { ...prev, ...data, metadata: data.metadata ?? prev.metadata };
            jobs.set(where.id, next);
            return next;
          },
        },
      }),
    ),
  },
}));

vi.mock("@/src/server/repositories/auto-round.repository", () => ({
  getAutoRoundJobById: vi.fn(async (jobId: string) => jobs.get(jobId) ?? null),
  listRunningAutoRoundJobs: vi.fn(async () => Array.from(jobs.values()).filter((row) => row.status === "RUNNING")),
  loadSchedulerLease: vi.fn(async () => null),
}));

vi.mock("@/src/server/repositories/auto-round-integrity.repository", () => ({
  auditAutoRoundIntegrity: vi.fn(async (jobId: string) => ({
    jobId,
    duplicateActiveRoundNos: {},
    orphanActiveRunId: false,
    activeRunCount: 0,
  })),
  shouldAcceptHeartbeatUpdate: vi.fn((current?: string, next?: string) => {
    if (!next) return true;
    if (!current) return true;
    return new Date(next).getTime() >= new Date(current).getTime();
  }),
}));

vi.mock("@/src/server/repositories/scheduler-recovery-audit.repository", async () => {
  const actual = await vi.importActual<typeof import("@/src/server/repositories/scheduler-recovery-audit.repository")>(
    "@/src/server/repositories/scheduler-recovery-audit.repository",
  );
  return {
    ...actual,
    appendRecoveryAuditEvent: vi.fn(async (input: { jobId: string; event: Record<string, unknown> }) => {
      const event = {
        ...input.event,
        id: `audit-${auditEvents.length + 1}`,
        timestamp: new Date().toISOString(),
      };
      auditEvents.unshift(event);
      const job = jobs.get(input.jobId) ?? { id: input.jobId, metadata: {} };
      jobs.set(input.jobId, {
        ...job,
        metadata: {
          ...(job.metadata as Record<string, unknown>),
          recoveryAudit: auditEvents.filter((row) => row.jobId === input.jobId),
          recoveryState: {
            recoveryCount: auditEvents.filter((row) => row.jobId === input.jobId).length,
            recoverySuccess: 1,
            recoveryFailure: 0,
            escalationLevel: 0,
            windowStartedAt: new Date().toISOString(),
          },
        },
      });
      return { event, state: { recoveryCount: 1, escalationLevel: 0 } };
    }),
    readRecoveryState: vi.fn(async (jobId: string) => ({
      recoveryCount: auditEvents.filter((row) => row.jobId === jobId).length,
      recoverySuccess: 1,
      recoveryFailure: 0,
      escalationLevel: 0,
      windowStartedAt: new Date().toISOString(),
      lastRecoveryAt: null,
      lastCause: null,
      lastDurationMs: 0,
    })),
    readRecoveryAuditTrail: vi.fn(async (jobId: string) => auditEvents.filter((row) => row.jobId === jobId)),
  };
});

function seedRunningJob(jobId: string) {
  jobs.set(jobId, {
    id: jobId,
    userId: "user-1",
    status: "RUNNING",
    activeRunId: null,
    metadata: {},
    rounds: [],
  });
}

describe("scheduler recovery manager", () => {
  beforeEach(() => {
    jobs.clear();
    auditEvents.length = 0;
    spawnCount = 0;
    recoveryQueues.clear();
    resetSchedulerOwnershipForTests();
    resetSchedulerWatchdogForTests();
    configureSchedulerRecovery({
      spawnScheduler: vi.fn(async () => {
        spawnCount += 1;
        return { action: "spawned", jobId: "job-recover", ownerId: "owner", generation: 1 };
      }),
      reconcileStaleWaitingRuns: vi.fn(async () => undefined),
      recoverRoundRegistry: vi.fn(),
      cancelRoundSelection: vi.fn(),
      stopJob: vi.fn(async () => undefined),
    });
  });

  it("decides RESUME for crashed scheduler without local loop", async () => {
    seedRunningJob("job-recover");
    const evaluation = await evaluateJobHealth("job-recover");
    expect(
      evaluation?.issues.some(
        (row) => row.failure === "SCHEDULER_CRASH" || row.failure === "SCHEDULER_LEASE_STALE",
      ),
    ).toBe(true);
    const decision = decideRecoveryPolicy({
      issues: evaluation!.issues,
      recoveryState: normalizeRecoveryWindow(evaluation!.recoveryState),
      hasLocalLoop: false,
      hasLiveLease: false,
      leaseOwnerId: null,
    });
    expect(decision.action).toBe("RESUME");
  });

  it("executes recovery through single authority and spawns once", async () => {
    seedRunningJob("job-recover");
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        executeSchedulerRecovery({ jobId: "job-recover", trigger: "fault_injection", operator: "automatic" }),
      ),
    );
    const successes = results.filter((row) => row.result === "success" || row.result === "skipped");
    expect(successes.length).toBe(25);
    expect(spawnCount).toBeLessThanOrEqual(1);
    expect(auditEvents.length).toBeGreaterThan(0);
  });

  it("keeps one watchdog per job under concurrent starts", async () => {
    const jobId = "job-watchdog";
    const results = await Promise.all(
      Array.from({ length: 50 }, () => atomicStartSchedulerWatchdog(jobId, 60_000)),
    );
    const started = results.filter((row) => row.action === "started");
    const attached = results.filter((row) => row.action === "attached");
    expect(started.length).toBe(1);
    expect(started.length + attached.length).toBe(50);
    expect(getWatchdogRegistrySnapshot().activeCount).toBe(1);
    stopSchedulerWatchdog(jobId);
    expect(getWatchdogRegistrySnapshot().activeCount).toBe(0);
  });

  it("escalates to STOP_JOB after recovery limit", () => {
    const state = normalizeRecoveryWindow({
      recoveryCount: 12,
      recoverySuccess: 0,
      recoveryFailure: 12,
      lastRecoveryAt: new Date().toISOString(),
      lastCause: "SCHEDULER_CRASH",
      lastDurationMs: 100,
      escalationLevel: 0,
      windowStartedAt: new Date().toISOString(),
    });
    const decision = decideRecoveryPolicy({
      issues: [
        {
          component: "scheduler",
          failure: "SCHEDULER_CRASH",
          severity: "critical",
          message: "crash",
        },
      ],
      recoveryState: state,
      hasLocalLoop: false,
      hasLiveLease: false,
      leaseOwnerId: null,
    });
    expect(decision.action).toBe("STOP_JOB");
  });

  it("persists audit trail with decision and duration", async () => {
    seedRunningJob("job-audit");
    const result = await executeSchedulerRecovery({
      jobId: "job-audit",
      trigger: "manual",
      operator: "manual",
      force: true,
    });
    expect(result.auditEvent.operator).toBe("manual");
    expect(result.auditEvent.trigger).toBe("manual");
    expect(result.auditEvent.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.auditEvent.decision.action).toBeDefined();
  });
});
