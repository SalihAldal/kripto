import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeEscalationLevel,
  normalizeRecoveryWindow,
} from "@/src/server/repositories/scheduler-recovery-audit.repository";

const jobs = new Map<string, Record<string, unknown>>();
const auditEvents: Array<Record<string, unknown>> = [];

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        autoRoundJob: {
          findUnique: async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null,
          updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const prev = jobs.get(where.id) ?? { id: where.id, metadata: {}, persistVersion: 0 };
            jobs.set(where.id, {
              ...prev,
              persistVersion: Number(prev.persistVersion ?? 0) + 1,
              metadata: data.metadata ?? prev.metadata,
            });
            return { count: 1 };
          },
        },
      }),
    ),
  },
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
      auditEvents.push(event);
      const job = jobs.get(input.jobId) ?? { id: input.jobId, metadata: {}, persistVersion: 0 };
      const meta = (job.metadata as Record<string, unknown>) ?? {};
      const state = normalizeRecoveryWindow(
        (meta.recoveryState as Record<string, unknown>) ?? {
          recoveryCount: 0,
          recoverySuccess: 0,
          recoveryFailure: 0,
          escalationLevel: 0,
          windowStartedAt: new Date().toISOString(),
        },
      );
      const incrementCounter =
        input.event.action !== "NO_ACTION" &&
        input.event.result !== "skipped" &&
        !(
          input.event.result === "success" &&
          input.event.action === "RECONCILE" &&
          input.event.failure === "REGISTRY_INTEGRITY"
        );
      const nextState = {
        ...state,
        recoveryCount: state.recoveryCount + (incrementCounter ? 1 : 0),
        recoveryFailure:
          input.event.result === "success" &&
          input.event.action === "RECONCILE" &&
          input.event.failure === "REGISTRY_INTEGRITY"
            ? 0
            : state.recoveryFailure + (input.event.result === "failure" && incrementCounter ? 1 : 0),
        recoverySuccess: state.recoverySuccess + (input.event.result === "success" && incrementCounter ? 1 : 0),
        escalationLevel: 0,
      };
      nextState.escalationLevel = computeEscalationLevel(nextState);
      jobs.set(input.jobId, {
        ...job,
        metadata: { ...meta, recoveryState: nextState, recoveryAudit: auditEvents },
      });
      return { event, state: nextState };
    }),
  };
});

import { appendRecoveryAuditEvent } from "@/src/server/repositories/scheduler-recovery-audit.repository";

describe("recovery idempotency", () => {
  beforeEach(() => {
    jobs.clear();
    auditEvents.length = 0;
    jobs.set("job-rec", {
      id: "job-rec",
      persistVersion: 0,
      metadata: {
        recoveryState: normalizeRecoveryWindow({
          recoveryCount: 2,
          recoverySuccess: 1,
          recoveryFailure: 4,
          escalationLevel: 3,
          lastRecoveryAt: null,
          lastCause: "REGISTRY_INTEGRITY",
          lastDurationMs: 0,
          windowStartedAt: new Date().toISOString(),
        }),
      },
    });
  });

  it("successful REGISTRY_INTEGRITY reconcile resets escalation failure count", async () => {
    const result = await appendRecoveryAuditEvent({
      jobId: "job-rec",
      event: {
        jobId: "job-rec",
        component: "registry",
        failure: "REGISTRY_INTEGRITY",
        decision: { action: "RECONCILE", reason: "reconcile", escalationLevel: 0 },
        action: "RECONCILE",
        result: "success",
        durationMs: 10,
        operator: "automatic",
        trigger: "watchdog",
        message: "Registry reconciled",
      },
    });
    expect(result?.state.recoveryFailure).toBe(0);
    expect(result?.state.escalationLevel).toBeLessThan(3);
  });

  it("repeated successful reconcile does not keep escalating", async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendRecoveryAuditEvent({
        jobId: "job-rec",
        event: {
          jobId: "job-rec",
          component: "registry",
          failure: "REGISTRY_INTEGRITY",
          decision: { action: "RECONCILE", reason: "reconcile", escalationLevel: 0 },
          action: "RECONCILE",
          result: "success",
          durationMs: 5,
          operator: "automatic",
          trigger: "watchdog",
          message: "Registry reconciled",
        },
      });
    }
    const meta = jobs.get("job-rec")?.metadata as Record<string, unknown>;
    const state = meta.recoveryState as { escalationLevel: number; recoveryFailure: number };
    expect(state.recoveryFailure).toBe(0);
    expect(state.escalationLevel).toBeLessThan(5);
  });
});
