import { prisma } from "@/src/server/db/prisma";
import {
  resolveAiConsensusTimeoutMs,
  resolveAsyncWorkerTimeoutMs,
} from "@/src/server/execution/cooperative-async.service";
import { runInstrumentedTransaction } from "@/src/server/forensics/transaction-telemetry.service";
import type { AutoRoundState } from "@/src/server/repositories/auto-round.repository";
import type { RoundOwnershipRecord } from "@/src/server/execution/round-registry.types";
import {
  readRoundRegistryFromMetadata,
} from "@/src/server/repositories/auto-round.repository";

export class OptimisticConcurrencyError extends Error {
  constructor(message = "Optimistic concurrency conflict") {
    super(message);
    this.name = "OptimisticConcurrencyError";
  }
}

const IN_PROGRESS_RUN_STATES: AutoRoundState[] = [
  "tariyor",
  "coin_secildi",
  "alim_yapildi",
  "satis_bekleniyor",
];
const TERMINAL_JOB_STATES = new Set<AutoRoundState>([
  "tur_basarisiz",
  "tur_tamamlandi",
  "sure_doldu",
  "satis_gerceklesti",
]);

const ROUND_REGISTRY_KEY = "roundRegistry";
const ACTIVE_ROUND_KEY = "activeRound";
const BEGIN_ROUND_MAX_RETRIES = 3;
const FAIL_ROUND_MAX_RETRIES = 3;
const COMPLETE_ROUND_MAX_RETRIES = 3;
const JOB_ACTIVE_PATCH_MAX_RETRIES = 2;
const OWNERSHIP_PERSIST_MAX_RETRIES = 3;

/** Hot-path txs run 1–2 bounded writes; budget scales with worker timeouts, not blind 25s default. */
export function resolveHotPathTransactionOptions() {
  const workerBudgetMs = Math.max(resolveAsyncWorkerTimeoutMs() / 4, resolveAiConsensusTimeoutMs() / 6);
  const timeoutMs = Math.max(35_000, Math.min(90_000, workerBudgetMs + 25_000));
  return {
    timeoutMs,
    maxWaitMs: Math.min(15_000, Math.floor(timeoutMs / 3)),
  };
}

const HOT_PATH_TX = resolveHotPathTransactionOptions();

export function buildActiveRoundIdempotencyKey(jobId: string, roundNo: number) {
  return `${jobId}:round:${roundNo}:active`;
}

export function buildTerminalRoundIdempotencyKey(jobId: string, roundNo: number, runId: string) {
  return `${jobId}:round:${roundNo}:terminal:${runId}`;
}

function mergeMetadata(
  current: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>,
) {
  return {
    ...((current ?? {}) as Record<string, unknown>),
    ...patch,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBeginRoundVersionConflict(error: unknown) {
  return error instanceof OptimisticConcurrencyError && error.message === "transactionallyBeginRound job version conflict";
}

function isFailRoundVersionConflict(error: unknown) {
  return error instanceof OptimisticConcurrencyError && error.message === "transactionallyFailRound job version conflict";
}

function isCompleteRoundVersionConflict(error: unknown) {
  return (
    error instanceof OptimisticConcurrencyError && error.message === "transactionallyCompleteRound job version conflict"
  );
}

export function shouldAcceptHeartbeatUpdate(currentHeartbeat?: string, nextHeartbeat?: string) {
  if (!nextHeartbeat) return true;
  if (!currentHeartbeat) return true;
  return new Date(nextHeartbeat).getTime() >= new Date(currentHeartbeat).getTime();
}

export async function transactionallyBeginRound(input: {
  jobId: string;
  roundNo: number;
  ownerId: string;
  ownership: RoundOwnershipRecord;
  state: AutoRoundState;
  metadata?: Record<string, unknown>;
}) {
  const idempotencyKey = buildActiveRoundIdempotencyKey(input.jobId, input.roundNo);
  for (let attempt = 0; attempt <= BEGIN_ROUND_MAX_RETRIES; attempt += 1) {
    try {
      return await runInstrumentedTransaction(
        "auto-round.beginRound",
        async (tx) => {
        const byKey = await tx.autoRoundRun.findUnique({
          where: { idempotencyKey },
        });
        if (byKey && !byKey.endedAt) {
          return { action: "attached" as const, run: byKey, idempotencyKey };
        }

        const existing = await tx.autoRoundRun.findFirst({
          where: {
            jobId: input.jobId,
            roundNo: input.roundNo,
            endedAt: null,
            state: { in: IN_PROGRESS_RUN_STATES },
          },
          orderBy: { startedAt: "desc" },
        });
        if (existing) {
          return { action: "attached" as const, run: existing, idempotencyKey: existing.idempotencyKey };
        }

        const job = await tx.autoRoundJob.findUnique({
          where: { id: input.jobId },
          select: { metadata: true, persistVersion: true },
        });
        if (!job) {
          throw new Error(`AutoRoundJob not found: ${input.jobId}`);
        }

        const meta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
        const registry = readRoundRegistryFromMetadata(meta);
        const registryKey = String(input.roundNo);
        const ownershipRecord = {
          ...input.ownership,
          runId: input.ownership.runId === "pending" ? "pending" : input.ownership.runId,
          updatedAt: new Date().toISOString(),
        };

        let run;
        try {
          run = await tx.autoRoundRun.create({
            data: {
              jobId: input.jobId,
              roundNo: input.roundNo,
              state: input.state,
              idempotencyKey,
              metadata: {
                ...(input.metadata ?? {}),
                roundOwnership: ownershipRecord,
              } as never,
            },
          });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === "P2002") {
            // Never query inside an already failed interactive transaction.
            // Retry in a fresh transaction to safely re-attach the raced run.
            throw new OptimisticConcurrencyError("transactionallyBeginRound idempotency race");
          }
          throw error;
        }

        ownershipRecord.runId = run.id;
        registry[registryKey] = { ...ownershipRecord, runId: run.id };

        const jobUpdate = await tx.autoRoundJob.updateMany({
          where: { id: input.jobId, persistVersion: job.persistVersion },
          data: {
            currentRound: input.roundNo,
            activeState: input.state,
            activeRunId: run.id,
            persistVersion: { increment: 1 },
            metadata: {
              ...meta,
              [ROUND_REGISTRY_KEY]: registry,
              [ACTIVE_ROUND_KEY]: {
                runId: run.id,
                roundNo: input.roundNo,
                ownerId: input.ownerId,
                heartbeatAt: new Date().toISOString(),
              },
            } as never,
          },
        });
        if (jobUpdate.count !== 1) {
          throw new OptimisticConcurrencyError("transactionallyBeginRound job version conflict");
        }
        return { action: "created" as const, run, idempotencyKey };
      },
      {
        ...HOT_PATH_TX,
        scope: {
          jobId: input.jobId,
          runId: idempotencyKey,
          roundId: String(input.roundNo),
        },
      },
      );
    } catch (error) {
      const isRetryableRace =
        error instanceof OptimisticConcurrencyError &&
        error.message === "transactionallyBeginRound idempotency race";
      if ((!isBeginRoundVersionConflict(error) && !isRetryableRace) || attempt >= BEGIN_ROUND_MAX_RETRIES) {
        throw error;
      }
      await sleep(25 * (attempt + 1));
    }
  }
  throw new OptimisticConcurrencyError("transactionallyBeginRound job version conflict");
}

export async function transactionallyFailRound(input: {
  jobId: string;
  runId: string;
  reason: string;
  symbol?: string;
  confidence?: number;
  rejectBucket?: string;
  activeState?: AutoRoundState;
  ownership?: RoundOwnershipRecord | null;
}) {
  for (let attempt = 0; attempt <= FAIL_ROUND_MAX_RETRIES; attempt += 1) {
    try {
      return await runInstrumentedTransaction(
        "auto-round.failRound",
        async (tx) => {
          const run = await tx.autoRoundRun.findUnique({ where: { id: input.runId } });
          if (!run) return { ok: false as const, action: "missing" as const };
          if (run.endedAt) {
            return { ok: true as const, action: "already_terminal" as const, run };
          }

          const runMeta = ((run.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
          const terminalKey = buildTerminalRoundIdempotencyKey(input.jobId, run.roundNo, run.id);

          const terminalNonExecutable = /NO_TRADE|NON_EXECUTABLE|NO_CANDIDATE|UYGUN COIN/i.test(input.reason);
          const resolvedSymbol = terminalNonExecutable ? null : (input.symbol ?? run.symbol);

          await tx.autoRoundRun.update({
            where: { id: input.runId },
            data: {
              state: "tur_basarisiz",
              failReason: input.reason,
              result: "failed",
              endedAt: new Date(),
              idempotencyKey: terminalKey,
              symbol: resolvedSymbol,
              persistVersion: { increment: 1 },
              metadata: mergeMetadata(runMeta, {
                rejectBucket: input.rejectBucket,
                failReason: input.reason,
                symbol: resolvedSymbol ?? "",
                confidence: input.confidence ?? runMeta.confidence ?? null,
              }) as never,
            },
          });

          const job = await tx.autoRoundJob.findUnique({
            where: { id: input.jobId },
            select: { persistVersion: true, metadata: true, activeRunId: true },
          });
          if (!job) return { ok: false as const, action: "missing_job" as const };

          const meta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
          const registry = readRoundRegistryFromMetadata(meta);
          if (input.ownership) {
            registry[String(run.roundNo)] = input.ownership;
          } else if (registry[String(run.roundNo)]) {
            registry[String(run.roundNo)] = {
              ...registry[String(run.roundNo)],
              status: "OWNERSHIP_RELEASED",
              updatedAt: new Date().toISOString(),
              version: registry[String(run.roundNo)].version + 1,
            };
          }

          const jobUpdate = await tx.autoRoundJob.updateMany({
            where: { id: input.jobId, persistVersion: job.persistVersion },
            data: {
              failedRounds: { increment: 1 },
              activeState: input.activeState ?? "tur_basarisiz",
              activeRunId: job.activeRunId === run.id ? null : job.activeRunId,
              lastError: input.reason,
              persistVersion: { increment: 1 },
              metadata: {
                ...meta,
                [ROUND_REGISTRY_KEY]: registry,
                activeRound: null,
              } as never,
            },
          });
          if (jobUpdate.count !== 1) {
            throw new OptimisticConcurrencyError("transactionallyFailRound job version conflict");
          }

          const updatedRun = await tx.autoRoundRun.findUnique({ where: { id: input.runId } });
          return { ok: true as const, action: "failed" as const, run: updatedRun };
        },
        {
          ...HOT_PATH_TX,
          scope: {
            jobId: input.jobId,
            runId: input.runId,
          },
        },
      );
    } catch (error) {
      if (!isFailRoundVersionConflict(error) || attempt >= FAIL_ROUND_MAX_RETRIES) {
        throw error;
      }
      await sleep(25 * (attempt + 1));
    }
  }
  throw new OptimisticConcurrencyError("transactionallyFailRound job version conflict");
}

export async function transactionallyCompleteRound(input: {
  jobId: string;
  runId: string;
  runPatch: {
    state: AutoRoundState;
    executionId?: string;
    sellPrice?: number;
    sellQty?: number;
    netPnl?: number;
    feeTotal?: number;
    result?: string;
    metadata?: Record<string, unknown>;
  };
  ownership?: RoundOwnershipRecord | null;
  jobMetadataPatch?: Record<string, unknown>;
}) {
  for (let attempt = 0; attempt <= COMPLETE_ROUND_MAX_RETRIES; attempt += 1) {
    try {
      return await runInstrumentedTransaction("auto-round.completeRound", async (tx) => {
    const run = await tx.autoRoundRun.findUnique({ where: { id: input.runId } });
    if (!run) return { ok: false as const, action: "missing" as const };
    if (run.endedAt && run.result) {
      return { ok: true as const, action: "already_terminal" as const, run };
    }

    const terminalKey = buildTerminalRoundIdempotencyKey(input.jobId, run.roundNo, run.id);
    const runMeta = ((run.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;

    await tx.autoRoundRun.update({
      where: { id: input.runId },
      data: {
        state: input.runPatch.state,
        executionId: input.runPatch.executionId,
        sellPrice: input.runPatch.sellPrice,
        sellQty: input.runPatch.sellQty,
        netPnl: input.runPatch.netPnl,
        feeTotal: input.runPatch.feeTotal,
        result: input.runPatch.result,
        endedAt: new Date(),
        idempotencyKey: terminalKey,
        persistVersion: { increment: 1 },
        metadata: mergeMetadata(runMeta, input.runPatch.metadata ?? {}) as never,
      },
    });

    const job = await tx.autoRoundJob.findUnique({
      where: { id: input.jobId },
      select: { persistVersion: true, metadata: true, activeRunId: true },
    });
    if (!job) return { ok: false as const, action: "missing_job" as const };

    const meta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const registry = readRoundRegistryFromMetadata(meta);
    if (input.ownership) {
      registry[String(run.roundNo)] = input.ownership;
    }

    const jobUpdate = await tx.autoRoundJob.updateMany({
      where: { id: input.jobId, persistVersion: job.persistVersion },
      data: {
        completedRounds: { increment: 1 },
        activeState: "tur_tamamlandi",
        activeRunId: job.activeRunId === run.id ? null : job.activeRunId,
        persistVersion: { increment: 1 },
        metadata: {
          ...meta,
          ...(input.jobMetadataPatch ?? {}),
          [ROUND_REGISTRY_KEY]: registry,
          activeRound: null,
        } as never,
      },
    });
        if (jobUpdate.count !== 1) {
          throw new OptimisticConcurrencyError("transactionallyCompleteRound job version conflict");
        }

        const updatedRun = await tx.autoRoundRun.findUnique({ where: { id: input.runId } });
        return { ok: true as const, action: "completed" as const, run: updatedRun };
      }, {
        ...HOT_PATH_TX,
        scope: { jobId: input.jobId, runId: input.runId },
      });
    } catch (error) {
      if (!isCompleteRoundVersionConflict(error) || attempt >= COMPLETE_ROUND_MAX_RETRIES) {
        throw error;
      }
      await sleep(25 * (attempt + 1));
    }
  }
  throw new OptimisticConcurrencyError("transactionallyCompleteRound job version conflict");
}

export async function idempotentMergeRunMetadata(input: {
  runId: string;
  jobId?: string;
  roundNo?: number;
  patch?: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  heartbeatAt?: string;
  state?: AutoRoundState;
  symbol?: string;
}) {
  return runInstrumentedTransaction(
    "auto-round.mergeRunMetadata",
    async (tx) => {
    const run = await tx.autoRoundRun.findUnique({ where: { id: input.runId } });
    if (!run) return { action: "missing" as const };

    const meta = ((run.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const currentRuntime = (meta.runtime as Record<string, unknown> | undefined) ?? {};
    if (input.runtime || input.heartbeatAt) {
      const nextHeartbeat = input.heartbeatAt ?? String(input.runtime?.heartbeatAt ?? "");
      if (!shouldAcceptHeartbeatUpdate(String(currentRuntime.heartbeatAt ?? ""), nextHeartbeat)) {
        return { action: "stale_ignored" as const, run };
      }
    }

    const nextMetadata = mergeMetadata(meta, {
      ...(input.patch ?? {}),
      ...(input.runtime ? { runtime: { ...currentRuntime, ...input.runtime } } : {}),
    });

    const updated = await tx.autoRoundRun.update({
      where: { id: input.runId },
      data: {
        state: input.state ?? undefined,
        symbol: input.symbol ?? undefined,
        persistVersion: { increment: 1 },
        metadata: nextMetadata as never,
      },
    });

    return { action: "merged" as const, run: updated };
  },
  {
    ...HOT_PATH_TX,
    scope: {
      jobId: input.jobId,
      runId: input.runId,
      roundId: input.roundNo ? String(input.roundNo) : undefined,
    },
  },
  );
}

export async function idempotentPatchJobActiveRound(input: {
  jobId: string;
  runId: string;
  roundNo: number;
  heartbeatAt?: string;
  step?: string;
  message?: string;
  activeState?: AutoRoundState;
  metadataPatch?: Record<string, unknown>;
}) {
  for (let attempt = 0; attempt <= JOB_ACTIVE_PATCH_MAX_RETRIES; attempt += 1) {
    const result = await runInstrumentedTransaction(
      "auto-round.patchJobActiveRound",
      async (tx) => {
        const job = await tx.autoRoundJob.findUnique({ where: { id: input.jobId } });
        if (!job) return { action: "missing" as const };
        if (TERMINAL_JOB_STATES.has(job.activeState as AutoRoundState)) {
          return { action: "terminal_ignored" as const };
        }

        const meta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
        const currentActive = (meta.activeRound as Record<string, unknown> | undefined) ?? {};
        const nextHeartbeat = input.heartbeatAt ?? new Date().toISOString();
        if (!shouldAcceptHeartbeatUpdate(String(currentActive.heartbeatAt ?? ""), nextHeartbeat)) {
          return { action: "stale_ignored" as const };
        }

        const nextMeta = mergeMetadata(meta, {
          ...(input.metadataPatch ?? {}),
          activeRound: {
            runId: input.runId,
            roundNo: input.roundNo,
            heartbeatAt: nextHeartbeat,
            step: input.step ?? currentActive.step,
            message: input.message ?? currentActive.message,
          },
        });

        const updated = await tx.autoRoundJob.updateMany({
          where: { id: input.jobId, persistVersion: job.persistVersion },
          data: {
            activeState: input.activeState ?? undefined,
            activeRunId: job.activeRunId ?? input.runId,
            persistVersion: { increment: 1 },
            metadata: nextMeta as never,
          },
        });
        if (updated.count !== 1) {
          return { action: "version_conflict" as const };
        }
        return { action: "patched" as const };
      },
      {
        ...HOT_PATH_TX,
        scope: {
          jobId: input.jobId,
          runId: input.runId,
          roundId: String(input.roundNo),
        },
      },
    );
    if (result.action !== "version_conflict" || attempt >= JOB_ACTIVE_PATCH_MAX_RETRIES) {
      return result;
    }
    await sleep(20 * (attempt + 1));
  }
  return { action: "version_conflict" as const };
}

export async function persistRoundOwnershipRecordTransactional(input: {
  jobId: string;
  record: RoundOwnershipRecord;
}) {
  for (let attempt = 0; attempt <= OWNERSHIP_PERSIST_MAX_RETRIES; attempt += 1) {
    try {
      return await runInstrumentedTransaction("auto-round.persistOwnership", async (tx) => {
        const job = await tx.autoRoundJob.findUnique({ where: { id: input.jobId } });
        if (!job) return null;

        const meta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
        const registry = readRoundRegistryFromMetadata(meta);
        const current = registry[String(input.record.roundNo)];
        if (current && current.version > input.record.version) {
          return current;
        }
        registry[String(input.record.roundNo)] = input.record;

        const updated = await tx.autoRoundJob.updateMany({
          where: { id: input.jobId, persistVersion: job.persistVersion },
          data: {
            persistVersion: { increment: 1 },
            metadata: {
              ...meta,
              [ROUND_REGISTRY_KEY]: registry,
            } as never,
          },
        });
        if (updated.count !== 1) {
          throw new OptimisticConcurrencyError("persistRoundOwnershipRecordTransactional version conflict");
        }
        return input.record;
      }, HOT_PATH_TX);
    } catch (error) {
      if (
        !(error instanceof OptimisticConcurrencyError) ||
        attempt >= OWNERSHIP_PERSIST_MAX_RETRIES
      ) {
        throw error;
      }
      await sleep(25 * (attempt + 1));
    }
  }
  throw new OptimisticConcurrencyError("persistRoundOwnershipRecordTransactional version conflict");
}

export async function auditAutoRoundIntegrity(jobId: string) {
  const [job, runs] = await Promise.all([
    prisma.autoRoundJob.findUnique({ where: { id: jobId } }),
    prisma.autoRoundRun.findMany({ where: { jobId }, orderBy: { startedAt: "desc" } }),
  ]);
  if (!job) return null;

  const activeRuns = runs.filter((run) => !run.endedAt);
  const duplicateActiveRoundNos = new Map<number, number>();
  for (const run of activeRuns) {
    duplicateActiveRoundNos.set(run.roundNo, (duplicateActiveRoundNos.get(run.roundNo) ?? 0) + 1);
  }

  return {
    jobId,
    persistVersion: job.persistVersion,
    activeRunId: job.activeRunId,
    completedRounds: job.completedRounds,
    failedRounds: job.failedRounds,
    currentRound: job.currentRound,
    activeRunCount: activeRuns.length,
    duplicateActiveRoundNos: Object.fromEntries(
      [...duplicateActiveRoundNos.entries()].filter(([, count]) => count > 1),
    ),
    orphanActiveRunId: job.activeRunId
      ? !activeRuns.some((run) => run.id === job.activeRunId)
      : false,
    totalRuns: runs.length,
  };
}
