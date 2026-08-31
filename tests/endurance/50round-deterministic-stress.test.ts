import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundOwnershipRecord } from "@/src/server/execution/round-registry.types";

type JobRow = {
  id: string;
  persistVersion: number;
  activeRunId: string | null;
  currentRound: number;
  completedRounds: number;
  failedRounds: number;
  activeState: string;
  lastError: string | null;
  status: string;
  stopRequested: boolean;
  totalRounds: number;
  metadata: Record<string, unknown> | null;
};

type RunRow = {
  id: string;
  jobId: string;
  roundNo: number;
  state: string;
  idempotencyKey: string | null;
  persistVersion: number;
  endedAt: Date | null;
  result: string | null;
  failReason: string | null;
  symbol: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: Date;
};

const jobs = new Map<string, JobRow>();
const runs = new Map<string, RunRow>();
const idempotencyIndex = new Map<string, string>();
const failJobUpdateManyOnce = new Set<string>();
let seq = 0;
let txLock: Promise<void> = Promise.resolve();

function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

function createTx() {
  return {
    autoRoundRun: {
      findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
        if (where.id) return runs.get(where.id) ?? null;
        if (where.idempotencyKey) {
          const runId = idempotencyIndex.get(where.idempotencyKey);
          return runId ? runs.get(runId) ?? null : null;
        }
        return null;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = Array.from(runs.values()).filter((row) => {
          if (where.jobId && row.jobId !== where.jobId) return false;
          if (where.roundNo && row.roundNo !== where.roundNo) return false;
          if (where.endedAt === null && row.endedAt !== null) return false;
          const stateFilter = where.state as { in?: string[] } | undefined;
          if (stateFilter?.in && !stateFilter.in.includes(row.state)) return false;
          return true;
        });
        rows.sort((a, b) => (a.id > b.id ? -1 : 1));
        return rows[0] ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextId("run");
        const idempotencyKey = (data.idempotencyKey as string | null) ?? null;
        if (idempotencyKey && idempotencyIndex.has(idempotencyKey)) {
          const err = new Error("Unique constraint") as Error & { code?: string };
          err.code = "P2002";
          throw err;
        }
        const row: RunRow = {
          id,
          jobId: String(data.jobId),
          roundNo: Number(data.roundNo),
          state: String(data.state),
          idempotencyKey,
          persistVersion: 0,
          endedAt: null,
          result: null,
          failReason: null,
          symbol: null,
          metadata: (data.metadata as Record<string, unknown> | null) ?? null,
          startedAt: new Date(),
        };
        runs.set(id, row);
        if (idempotencyKey) idempotencyIndex.set(idempotencyKey, id);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const prev = runs.get(where.id);
        if (!prev) throw new Error("run missing");
        const next: RunRow = {
          ...prev,
          state: (data.state as string | undefined) ?? prev.state,
          symbol: (data.symbol as string | undefined) ?? prev.symbol,
          endedAt: (data.endedAt as Date | undefined) ?? prev.endedAt,
          result: (data.result as string | undefined) ?? prev.result,
          failReason: (data.failReason as string | undefined) ?? prev.failReason,
          metadata: (data.metadata as Record<string, unknown> | undefined) ?? prev.metadata,
          persistVersion:
            data.persistVersion && typeof data.persistVersion === "object"
              ? prev.persistVersion + 1
              : prev.persistVersion,
        };
        if (data.idempotencyKey) {
          if (prev.idempotencyKey) idempotencyIndex.delete(prev.idempotencyKey);
          next.idempotencyKey = String(data.idempotencyKey);
          idempotencyIndex.set(next.idempotencyKey, next.id);
        }
        runs.set(where.id, next);
        return next;
      },
    },
    autoRoundJob: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const row = jobs.get(where.id);
        if (!row) return null;
        if (!select) return row;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(select)) {
          if (select[key]) out[key] = row[key as keyof JobRow];
        }
        return out;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; persistVersion?: number };
        data: Record<string, unknown>;
      }) => {
        const row = jobs.get(where.id);
        if (!row) return { count: 0 };
        if (failJobUpdateManyOnce.has(where.id)) {
          failJobUpdateManyOnce.delete(where.id);
          return { count: 0 };
        }
        if (where.persistVersion !== undefined && row.persistVersion !== where.persistVersion) {
          return { count: 0 };
        }
        const next: JobRow = { ...row };
        if (data.failedRounds && typeof data.failedRounds === "object") next.failedRounds += 1;
        if (data.completedRounds && typeof data.completedRounds === "object") next.completedRounds += 1;
        if (data.persistVersion && typeof data.persistVersion === "object") next.persistVersion += 1;
        if (data.currentRound !== undefined) next.currentRound = Number(data.currentRound);
        if (data.activeRunId !== undefined) next.activeRunId = (data.activeRunId as string | null) ?? null;
        if (data.activeState !== undefined) next.activeState = String(data.activeState);
        if (data.lastError !== undefined) next.lastError = (data.lastError as string | null) ?? null;
        if (data.metadata) next.metadata = data.metadata as Record<string, unknown>;
        jobs.set(where.id, next);
        return { count: 1 };
      },
    },
  };
}

vi.mock("@/src/server/db/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: ReturnType<typeof createTx>) => Promise<unknown>) => {
      const run = async () => {
        const tx = createTx();
        return fn(tx);
      };
      const next = txLock.then(run, run);
      txLock = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
    autoRoundJob: {
      findUnique: async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null,
    },
    autoRoundRun: {
      findMany: async ({ where }: { where: { jobId: string } }) =>
        Array.from(runs.values()).filter((row) => row.jobId === where.jobId),
    },
  },
}));

import {
  auditAutoRoundIntegrity,
  buildActiveRoundIdempotencyKey,
  transactionallyBeginRound,
  transactionallyFailRound,
} from "@/src/server/repositories/auto-round-integrity.repository";
import {
  validateCounterIntegrity,
  ownership,
  pickBusinessReason,
} from "./endurance-harness";

function seedJob(jobId: string, totalRounds = 50) {
  jobs.set(jobId, {
    id: jobId,
    persistVersion: 0,
    activeRunId: null,
    currentRound: 0,
    completedRounds: 0,
    failedRounds: 0,
    activeState: "bekliyor",
    lastError: null,
    status: "RUNNING",
    stopRequested: false,
    totalRounds,
    metadata: {},
  });
}

function armVersionConflictOnce(jobId: string) {
  failJobUpdateManyOnce.add(jobId);
}

describe("50-round deterministic endurance stress", () => {
  beforeEach(() => {
    jobs.clear();
    runs.clear();
    idempotencyIndex.clear();
    failJobUpdateManyOnce.clear();
    seq = 0;
    txLock = Promise.resolve();
  });

  it("completes 50 logical rounds with mixed business rejections", async () => {
    const jobId = "job-50-business";
    seedJob(jobId, 50);

    for (let roundNo = 1; roundNo <= 50; roundNo += 1) {
      const begin = await transactionallyBeginRound({
        jobId,
        roundNo,
        ownerId: "owner-a",
        ownership: ownership(jobId, roundNo),
        state: "tariyor",
      });
      const runId = begin.run.id;
      const reason = pickBusinessReason(roundNo);
      const fail = await transactionallyFailRound({
        jobId,
        runId,
        reason,
        rejectBucket: "policy",
      });
      expect(fail.action).toMatch(/failed|already_terminal/);
    }

    const job = jobs.get(jobId)!;
    expect(job.failedRounds).toBe(50);
    expect(job.completedRounds).toBe(0);
    const jobRuns = Array.from(runs.values()).filter((r) => r.jobId === jobId);
    expect(jobRuns.length).toBe(50);
    expect(jobRuns.every((r) => r.endedAt)).toBe(true);
    const integrity = validateCounterIntegrity(job, jobRuns);
    expect(integrity.ok, integrity.issues.join("; ")).toBe(true);

    const audit = await auditAutoRoundIntegrity(jobId);
    expect(Object.keys(audit?.duplicateActiveRoundNos ?? {}).length).toBe(0);
    expect(audit?.orphanActiveRunId).toBe(false);
    expect(audit?.activeRunCount).toBe(0);
  });

  it("survives transient version conflicts across 50 rounds", async () => {
    const jobId = "job-50-version-conflict";
    seedJob(jobId, 50);

    for (let roundNo = 1; roundNo <= 50; roundNo += 1) {
      if (roundNo % 7 === 0) armVersionConflictOnce(jobId);
      const begin = await transactionallyBeginRound({
        jobId,
        roundNo,
        ownerId: "owner-a",
        ownership: ownership(jobId, roundNo),
        state: "tariyor",
      });
      await transactionallyFailRound({
        jobId,
        runId: begin.run.id,
        reason: pickBusinessReason(roundNo),
      });
    }

    const job = jobs.get(jobId)!;
    expect(job.failedRounds).toBe(50);
    const integrity = validateCounterIntegrity(
      job,
      Array.from(runs.values()).filter((r) => r.jobId === jobId),
    );
    expect(integrity.ok, integrity.issues.join("; ")).toBe(true);
  });

  it("handles P2002 idempotent attach without 25P02 across rounds", async () => {
    const jobId = "job-p2002-50";
    seedJob(jobId, 50);

    for (let roundNo = 1; roundNo <= 50; roundNo += 1) {
      const idempotencyKey = buildActiveRoundIdempotencyKey(jobId, roundNo);
      if (roundNo % 11 === 0) {
        runs.set(`pre-${roundNo}`, {
          id: `pre-${roundNo}`,
          jobId,
          roundNo,
          state: "tariyor",
          idempotencyKey,
          persistVersion: 0,
          endedAt: null,
          result: null,
          failReason: null,
          symbol: null,
          metadata: null,
          startedAt: new Date(),
        });
        idempotencyIndex.set(idempotencyKey, `pre-${roundNo}`);
      }

      const begin = await transactionallyBeginRound({
        jobId,
        roundNo,
        ownerId: "owner-a",
        ownership: ownership(jobId, roundNo),
        state: "tariyor",
      });
      expect(["created", "attached"]).toContain(begin.action);
      await transactionallyFailRound({
        jobId,
        runId: begin.run.id,
        reason: pickBusinessReason(roundNo),
      });
    }

    expect(jobs.get(jobId)?.failedRounds).toBe(50);
  });

  it("idempotent double-fail does not corrupt counters over 50 rounds", async () => {
    const jobId = "job-double-fail";
    seedJob(jobId, 50);

    for (let roundNo = 1; roundNo <= 50; roundNo += 1) {
      const begin = await transactionallyBeginRound({
        jobId,
        roundNo,
        ownerId: "owner-a",
        ownership: ownership(jobId, roundNo),
        state: "tariyor",
      });
      const first = await transactionallyFailRound({
        jobId,
        runId: begin.run.id,
        reason: pickBusinessReason(roundNo),
      });
      const second = await transactionallyFailRound({
        jobId,
        runId: begin.run.id,
        reason: pickBusinessReason(roundNo),
      });
      expect(first.action).toBe("failed");
      expect(second.action).toBe("already_terminal");
    }

    expect(jobs.get(jobId)?.failedRounds).toBe(50);
  });

  it("concurrent terminal writers on same round leave single terminal state", async () => {
    const jobId = "job-concurrent-terminal";
    seedJob(jobId, 10);
    const begin = await transactionallyBeginRound({
      jobId,
      roundNo: 1,
      ownerId: "owner-a",
      ownership: ownership(jobId, 1),
      state: "tariyor",
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        transactionallyFailRound({
          jobId,
          runId: begin.run.id,
          reason: "AI_VETO: concurrent test",
        }),
      ),
    );
    const failed = results.filter((r) => r.action === "failed");
    const already = results.filter((r) => r.action === "already_terminal");
    expect(failed.length).toBe(1);
    expect(failed.length + already.length).toBe(20);
    expect(jobs.get(jobId)?.failedRounds).toBe(1);
  });
});
