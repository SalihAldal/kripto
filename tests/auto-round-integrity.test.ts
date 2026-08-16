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
};

const jobs = new Map<string, JobRow>();
const runs = new Map<string, RunRow>();
const idempotencyIndex = new Map<string, string>();
let seq = 0;
let txLock: Promise<void> = Promise.resolve();

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

const IN_PROGRESS = ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"];

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
      findMany: async ({ where }: { where: { jobId: string } }) =>
        Array.from(runs.values()).filter((row) => row.jobId === where.jobId),
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
        if (where.persistVersion !== undefined && row.persistVersion !== where.persistVersion) {
          return { count: 0 };
        }
        const next: JobRow = { ...row };
        if (data.currentRound !== undefined) next.currentRound = Number(data.currentRound);
        if (data.activeState !== undefined) next.activeState = String(data.activeState);
        if (data.activeRunId !== undefined) next.activeRunId = (data.activeRunId as string | null) ?? null;
        if (data.lastError !== undefined) next.lastError = (data.lastError as string | null) ?? null;
        if (data.failedRounds && typeof data.failedRounds === "object") {
          next.failedRounds += 1;
        }
        if (data.completedRounds && typeof data.completedRounds === "object") {
          next.completedRounds += 1;
        }
        if (data.persistVersion && typeof data.persistVersion === "object") {
          next.persistVersion += 1;
        }
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
  idempotentMergeRunMetadata,
  idempotentPatchJobActiveRound,
  shouldAcceptHeartbeatUpdate,
  transactionallyBeginRound,
  transactionallyCompleteRound,
  transactionallyFailRound,
} from "@/src/server/repositories/auto-round-integrity.repository";

const stressLevels = [25, 50, 100];

function seedJob(jobId: string) {
  jobs.set(jobId, {
    id: jobId,
    persistVersion: 0,
    activeRunId: null,
    currentRound: 0,
    completedRounds: 0,
    failedRounds: 0,
    activeState: "bekliyor",
    lastError: null,
    metadata: {},
  });
}

function ownership(jobId: string, roundNo: number): RoundOwnershipRecord {
  return {
    jobId,
    roundNo,
    roundOwner: "owner-a:g1",
    runId: "pending",
    status: "OWNERSHIP_ACQUIRED",
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("auto round database integrity", () => {
  beforeEach(() => {
    jobs.clear();
    runs.clear();
    idempotencyIndex.clear();
    seq = 0;
    txLock = Promise.resolve();
  });

  it.each(stressLevels)(
    "transactionallyBeginRound keeps one active run under %i concurrent creates",
    async (count) => {
      const jobId = "job-integrity";
      seedJob(jobId);
      const roundNo = 58;

      const results = await Promise.all(
        Array.from({ length: count }, () =>
          transactionallyBeginRound({
            jobId,
            roundNo,
            ownerId: "owner-a",
            ownership: ownership(jobId, roundNo),
            state: "tariyor",
          }),
        ),
      );

      const created = results.filter((row) => row.action === "created");
      const attached = results.filter((row) => row.action === "attached");
      const runIds = new Set(results.map((row) => row.run.id));

      expect(created.length).toBe(1);
      expect(created.length + attached.length).toBe(count);
      expect(runIds.size).toBe(1);

      const active = Array.from(runs.values()).filter(
        (row) => row.jobId === jobId && row.roundNo === roundNo && !row.endedAt,
      );
      expect(active.length).toBe(1);
      expect(jobs.get(jobId)?.currentRound).toBe(roundNo);
      expect(jobs.get(jobId)?.activeRunId).toBe(active[0]?.id);
    },
  );

  it("transactionallyFailRound increments failedRounds once", async () => {
    const jobId = "job-fail";
    seedJob(jobId);
    const begin = await transactionallyBeginRound({
      jobId,
      roundNo: 1,
      ownerId: "owner-a",
      ownership: ownership(jobId, 1),
      state: "tariyor",
    });
    const runId = begin.run.id;

    const first = await transactionallyFailRound({
      jobId,
      runId,
      reason: "scanner timeout",
      rejectBucket: "scanner",
    });
    const second = await transactionallyFailRound({
      jobId,
      runId,
      reason: "scanner timeout",
      rejectBucket: "scanner",
    });

    expect(first.action).toBe("failed");
    expect(second.action).toBe("already_terminal");
    expect(jobs.get(jobId)?.failedRounds).toBe(1);
  });

  it("transactionallyCompleteRound increments completedRounds once", async () => {
    const jobId = "job-complete";
    seedJob(jobId);
    const begin = await transactionallyBeginRound({
      jobId,
      roundNo: 2,
      ownerId: "owner-a",
      ownership: ownership(jobId, 2),
      state: "tariyor",
    });
    const runId = begin.run.id;

    const first = await transactionallyCompleteRound({
      jobId,
      runId,
      runPatch: { state: "tur_tamamlandi", result: "profit" },
      jobMetadataPatch: { usedSymbols: ["BTCTRY"] },
    });
    const second = await transactionallyCompleteRound({
      jobId,
      runId,
      runPatch: { state: "tur_tamamlandi", result: "profit" },
    });

    expect(first.action).toBe("completed");
    expect(second.action).toBe("already_terminal");
    expect(jobs.get(jobId)?.completedRounds).toBe(1);
    expect((jobs.get(jobId)?.metadata as Record<string, unknown>).usedSymbols).toEqual(["BTCTRY"]);
  });

  it("idempotent heartbeat merge ignores stale writes", async () => {
    const jobId = "job-heartbeat";
    seedJob(jobId);
    const begin = await transactionallyBeginRound({
      jobId,
      roundNo: 3,
      ownerId: "owner-a",
      ownership: ownership(jobId, 3),
      state: "tariyor",
    });
    const runId = begin.run.id;

    await idempotentMergeRunMetadata({
      runId,
      heartbeatAt: "2026-08-06T12:00:01.000Z",
      runtime: { heartbeatAt: "2026-08-06T12:00:01.000Z", step: "scan" },
    });
    const stale = await idempotentMergeRunMetadata({
      runId,
      heartbeatAt: "2026-08-06T11:59:59.000Z",
      runtime: { heartbeatAt: "2026-08-06T11:59:59.000Z", step: "stale" },
    });
    const fresh = await idempotentMergeRunMetadata({
      runId,
      heartbeatAt: "2026-08-06T12:00:05.000Z",
      runtime: { heartbeatAt: "2026-08-06T12:00:05.000Z", step: "select" },
    });

    expect(stale.action).toBe("stale_ignored");
    expect(fresh.action).toBe("merged");
    const runtime = ((runs.get(runId)?.metadata ?? {}) as Record<string, unknown>).runtime as Record<
      string,
      unknown
    >;
    expect(runtime.step).toBe("select");
  });

  it("auditAutoRoundIntegrity detects duplicate active round numbers", async () => {
    const jobId = "job-audit";
    seedJob(jobId);
    runs.set("run-a", {
      id: "run-a",
      jobId,
      roundNo: 9,
      state: "tariyor",
      idempotencyKey: buildActiveRoundIdempotencyKey(jobId, 9),
      persistVersion: 0,
      endedAt: null,
      result: null,
      failReason: null,
      symbol: null,
      metadata: null,
    });
    runs.set("run-b", {
      id: "run-b",
      jobId,
      roundNo: 9,
      state: "tariyor",
      idempotencyKey: null,
      persistVersion: 0,
      endedAt: null,
      result: null,
      failReason: null,
      symbol: null,
      metadata: null,
    });
    jobs.set(jobId, {
      ...(jobs.get(jobId) as JobRow),
      activeRunId: "run-missing",
    });

    const audit = await auditAutoRoundIntegrity(jobId);
    expect(audit?.duplicateActiveRoundNos).toEqual({ "9": 2 });
    expect(audit?.orphanActiveRunId).toBe(true);
  });

  it("shouldAcceptHeartbeatUpdate is monotonic", () => {
    expect(shouldAcceptHeartbeatUpdate("2026-08-06T12:00:00.000Z", "2026-08-06T12:00:01.000Z")).toBe(true);
    expect(shouldAcceptHeartbeatUpdate("2026-08-06T12:00:01.000Z", "2026-08-06T12:00:00.000Z")).toBe(false);
  });

  it("idempotentPatchJobActiveRound keeps job pointer separate from run runtime", async () => {
    const jobId = "job-pointer";
    seedJob(jobId);
    const begin = await transactionallyBeginRound({
      jobId,
      roundNo: 4,
      ownerId: "owner-a",
      ownership: ownership(jobId, 4),
      state: "tariyor",
    });
    const runId = begin.run.id;
    const t1 = new Date(Date.now() + 1000).toISOString();
    const t2 = new Date(Date.now() + 2000).toISOString();

    await idempotentPatchJobActiveRound({
      jobId,
      runId,
      roundNo: 4,
      heartbeatAt: t1,
      step: "scanning",
      message: "scan",
    });
    await idempotentMergeRunMetadata({
      runId,
      heartbeatAt: t2,
      runtime: { heartbeatAt: t2, step: "scanning", heavy: true },
    });

    const jobMeta = jobs.get(jobId)?.metadata as Record<string, unknown>;
    const runMeta = runs.get(runId)?.metadata as Record<string, unknown>;
    expect((jobMeta.activeRound as Record<string, unknown>).step).toBe("scanning");
    expect((runMeta.runtime as Record<string, unknown>).heavy).toBe(true);
    expect(jobMeta.runtime).toBeUndefined();
  });
});
