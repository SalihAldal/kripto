import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  getAutoRoundJobById,
  getAutoRoundRunById,
  type AutoRoundState,
} from "@/src/server/repositories/auto-round.repository";
import {
  idempotentMergeRunMetadata,
  idempotentPatchJobActiveRound,
} from "@/src/server/repositories/auto-round-integrity.repository";
import { withBoundedPrisma } from "@/src/server/execution/bounded-prisma.service";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import {
  RoundSelectionAbortError,
  computeCompositeRoundProgress,
  mapRuntimeStepToCoarseState,
  snapshotToCompositeInput,
  type RoundRuntimeSnapshot,
  type RoundRuntimeStep,
  type RoundSelectionRuntimeOptions,
  type RoundTimelineEntry,
  type RoundTimelineKind,
} from "@/src/server/execution/round-runtime.types";

const cancelControllers = new Map<string, AbortController>();
const MAX_TIMELINE = 120;

function resolveHeartbeatIntervalMs() {
  return Math.max(1000, Math.min(10_000, env.AUTO_ROUND_HEARTBEAT_INTERVAL_MS ?? 2000));
}

function trimTimeline(timeline: RoundTimelineEntry[]) {
  if (timeline.length <= MAX_TIMELINE) return timeline;
  return timeline.slice(timeline.length - MAX_TIMELINE);
}

export function registerRoundCancellation(jobId: string) {
  const existing = cancelControllers.get(jobId);
  if (existing) return existing;
  const controller = new AbortController();
  cancelControllers.set(jobId, controller);
  return controller;
}

export function cancelRoundSelection(jobId: string, reason: string) {
  const controller = cancelControllers.get(jobId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort(reason);
  logger.warn({ jobId, reason }, "Round selection cancellation signal propagated");
  return true;
}

export function startSelectionBudgetEnforcer(
  jobId: string,
  selectionStartedAt: number,
  selectionBudgetMs: number,
): () => void {
  const deadlineMs = selectionStartedAt + selectionBudgetMs;
  const timer = setInterval(() => {
    if (Date.now() < deadlineMs) return;
    cancelRoundSelection(
      jobId,
      `Tur secim suresi doldu (${Math.floor(selectionBudgetMs / 1000)}s)`,
    );
    clearInterval(timer);
  }, 1000);
  return () => clearInterval(timer);
}

export function clearRoundCancellation(jobId: string) {
  cancelControllers.delete(jobId);
}

export function getRoundCancellationSignal(jobId: string) {
  return cancelControllers.get(jobId)?.signal;
}

export class RoundRuntimeController {
  private snapshot: RoundRuntimeSnapshot;
  private lastHeartbeatAt = 0;
  private lastProgressAt = 0;
  private readonly maxSelectionAttempts: number;

  constructor(
    private readonly options: RoundSelectionRuntimeOptions,
    maxSelectionAttempts: number,
  ) {
    this.maxSelectionAttempts = maxSelectionAttempts;
    this.snapshot = {
      step: "ROUND_CREATED",
      message: `Tur ${options.roundNo} baslatildi`,
      coarseState: "tariyor",
      candidatesProcessed: 0,
      retryCount: 0,
      selectionAttempt: options.selectionAttempt,
      roundProgressPct: 0,
      elapsedMs: 0,
      selectionBudgetMs: options.selectionBudgetMs,
      heartbeatAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
      timeline: [],
    };
    this.lastProgressAt = Date.now();
  }

  getLastProgressAt() {
    return this.snapshot.lastProgressAt;
  }

  noteProgress(message?: string, patch?: Partial<RoundRuntimeSnapshot>) {
    const now = Date.now();
    this.lastProgressAt = now;
    this.snapshot.lastProgressAt = new Date(now).toISOString();
    if (message) this.snapshot.message = message;
    if (patch) Object.assign(this.snapshot, patch);
    this.refreshProgress();
  }

  getSnapshot() {
    return { ...this.snapshot, timeline: [...this.snapshot.timeline] };
  }

  private touchHeartbeatClock() {
    const now = Date.now();
    this.lastHeartbeatAt = now;
    this.snapshot.heartbeatAt = new Date(now).toISOString();
  }

  private pushTimeline(kind: RoundTimelineKind, message: string, extra?: Partial<RoundTimelineEntry>) {
    this.snapshot.timeline = trimTimeline([
      ...this.snapshot.timeline,
      {
        at: new Date().toISOString(),
        kind,
        step: this.snapshot.step,
        message,
        symbol: this.snapshot.currentSymbol ?? this.snapshot.currentCandidate,
        pipeline: this.snapshot.currentPipeline,
        attempt: this.snapshot.selectionAttempt,
        ...extra,
      },
    ]);
  }

  private refreshProgress() {
    const breakdown = computeCompositeRoundProgress(
      snapshotToCompositeInput(this.snapshot, {
        roundNo: this.options.roundNo,
        totalRounds: this.options.totalRounds,
        maxSelectionAttempts: this.maxSelectionAttempts,
      }),
    );
    this.snapshot.progressBreakdown = breakdown;
    this.snapshot.intraRoundPct = breakdown.intraRound;
    this.snapshot.roundProgressPct = breakdown.overall;
  }

  async transition(step: RoundRuntimeStep, message: string, patch?: Partial<RoundRuntimeSnapshot>) {
    this.snapshot.step = step;
    this.snapshot.message = message;
    this.snapshot.coarseState = mapRuntimeStepToCoarseState(step);
    if (patch) Object.assign(this.snapshot, patch);
    this.snapshot.elapsedMs = Date.now() - this.options.selectionStartedAt;
    this.snapshot.estimatedRemainingMs = Math.max(0, this.options.selectionBudgetMs - this.snapshot.elapsedMs);
    this.lastProgressAt = Date.now();
    this.snapshot.lastProgressAt = new Date(this.lastProgressAt).toISOString();
    this.touchHeartbeatClock();
    this.refreshProgress();
    this.pushTimeline("step", message);
    await this.persist(true);
  }

  async heartbeat(message?: string) {
    const now = Date.now();
    if (now - this.lastHeartbeatAt < resolveHeartbeatIntervalMs()) {
      this.checkBudget(true);
      return;
    }
    this.touchHeartbeatClock();
    this.snapshot.elapsedMs = now - this.options.selectionStartedAt;
    this.snapshot.estimatedRemainingMs = Math.max(0, this.options.selectionBudgetMs - this.snapshot.elapsedMs);
    if (message) this.snapshot.message = message;
    this.refreshProgress();
    this.pushTimeline("heartbeat", message ?? this.snapshot.message);
    await this.persist(false);
    this.checkBudget(true);
  }

  checkBudget(throwOnExpire = true) {
    const signal = getRoundCancellationSignal(this.options.jobId);
    if (signal?.aborted) {
      const reason = String(signal.reason ?? "Selection cancelled");
      if (throwOnExpire) {
        throw new RoundSelectionAbortError("CANCELLED", reason);
      }
      return false;
    }
    if (Date.now() - this.options.selectionStartedAt >= this.options.selectionBudgetMs) {
      if (throwOnExpire) {
        throw new RoundSelectionAbortError(
          "BUDGET_EXPIRED",
          `Tur secim suresi doldu (${Math.floor(this.options.selectionBudgetMs / 1000)}s)`,
        );
      }
      return false;
    }
    return true;
  }

  async ensureJobActive() {
    if (this.options.shouldStopJob) {
      const stop = await this.options.shouldStopJob();
      if (stop) {
        throw new RoundSelectionAbortError("JOB_STOPPED", "Tur motoru durduruldu");
      }
    }
    this.checkBudget(true);
  }

  async noteCandidateRejected(symbol: string, reason: string) {
    this.snapshot.candidatesProcessed += 1;
    this.snapshot.currentCandidate = symbol;
    this.snapshot.currentSymbol = symbol;
    this.snapshot.retryCount += 1;
    await this.transition("CANDIDATE_REJECTED", `${symbol}: ${reason}`, {
      currentPipeline: "pump-confirmation",
    });
    await this.transition("NEXT_CANDIDATE", "Sonraki aday deneniyor");
  }

  async persist(forceCoarseStateUpdate: boolean) {
    const snapshot = this.getSnapshot();
    if (this.options.onPersist) {
      await this.options.onPersist(snapshot);
      return;
    }
    await withBoundedPrisma("round-runtime.patchJobActiveRound", () =>
      idempotentPatchJobActiveRound({
        jobId: this.options.jobId,
        runId: this.options.runId,
        roundNo: this.options.roundNo,
        heartbeatAt: snapshot.heartbeatAt,
        step: snapshot.step,
        message: snapshot.message,
        activeState: forceCoarseStateUpdate ? snapshot.coarseState : undefined,
      }),
    );
    await withBoundedPrisma("round-runtime.mergeRunMetadata", () =>
      idempotentMergeRunMetadata({
        runId: this.options.runId,
        runtime: snapshot as unknown as Record<string, unknown>,
        heartbeatAt: snapshot.heartbeatAt,
        state: forceCoarseStateUpdate ? snapshot.coarseState : undefined,
        symbol: snapshot.currentSymbol,
        patch: {
          selectionAttempt: snapshot.selectionAttempt,
          roundProgressPct: snapshot.roundProgressPct,
          intraRoundPct: snapshot.intraRoundPct,
          progressBreakdown: snapshot.progressBreakdown,
        },
      }),
    );
    publishExecutionEvent({
      executionId: `round-job-${this.options.jobId}`,
      symbol: snapshot.currentSymbol,
      stage: "round-runtime",
      status: snapshot.step === "ROUND_FAILED" || snapshot.step === "TIMEOUT" ? "FAILED" : "RUNNING",
      level: "INFO",
      message: snapshot.message,
      context: {
        jobId: this.options.jobId,
        runId: this.options.runId,
        roundNo: this.options.roundNo,
        runtime: snapshot,
      },
    });
    await writeStructuredLog({
      level: "INFO",
      source: "auto-round-runtime",
      message: snapshot.message,
      actionType: "round_runtime_heartbeat",
      status: "RUNNING",
      transactionId: this.options.jobId,
      context: {
        runId: this.options.runId,
        roundNo: this.options.roundNo,
        step: snapshot.step,
        roundProgressPct: snapshot.roundProgressPct,
        intraRoundPct: snapshot.intraRoundPct,
        progressBreakdown: snapshot.progressBreakdown,
        elapsedMs: snapshot.elapsedMs,
      },
    }).catch(() => null);
  }

  async failTimeout(reason: string) {
    await this.transition("TIMEOUT", reason);
    this.pushTimeline("timeout", reason);
    await this.persist(true);
  }
}

export async function patchRoundRuntimeProgress(input: {
  jobId: string;
  runId: string;
  roundNo: number;
  totalRounds: number;
  maxSelectionAttempts?: number;
  patch?: Partial<RoundRuntimeSnapshot>;
}) {
  const job = await getAutoRoundJobById(input.jobId);
  if (!job) return null;
  const run = await getAutoRoundRunById(input.runId).catch(() => null);
  const jobMeta = ((job.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const runMeta = ((run?.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const existing = readRuntimeFromMetadata(runMeta) ?? readRuntimeFromMetadata(jobMeta);
  const snapshot: RoundRuntimeSnapshot = {
    step: "ROUND_CREATED",
    message: "Runtime progress sync",
    coarseState: "tariyor",
    candidatesProcessed: 0,
    retryCount: 0,
    selectionAttempt: 1,
    roundProgressPct: 0,
    elapsedMs: 0,
    selectionBudgetMs: 0,
    heartbeatAt: new Date().toISOString(),
    timeline: [],
    ...existing,
    ...input.patch,
  } as RoundRuntimeSnapshot;

  const breakdown = computeCompositeRoundProgress(
    snapshotToCompositeInput(snapshot, {
      roundNo: input.roundNo,
      totalRounds: input.totalRounds,
      maxSelectionAttempts: Math.max(1, input.maxSelectionAttempts ?? 3),
    }),
  );
  snapshot.progressBreakdown = breakdown;
  snapshot.intraRoundPct = breakdown.intraRound;
  snapshot.roundProgressPct = breakdown.overall;
  snapshot.heartbeatAt = new Date().toISOString();

  await idempotentPatchJobActiveRound({
    jobId: input.jobId,
    runId: input.runId,
    roundNo: input.roundNo,
    heartbeatAt: snapshot.heartbeatAt,
    step: snapshot.step,
    message: snapshot.message,
  });
  await idempotentMergeRunMetadata({
    runId: input.runId,
    runtime: snapshot as unknown as Record<string, unknown>,
    heartbeatAt: snapshot.heartbeatAt,
    patch: {
      roundProgressPct: snapshot.roundProgressPct,
      intraRoundPct: snapshot.intraRoundPct,
      progressBreakdown: snapshot.progressBreakdown,
    },
  });

  publishExecutionEvent({
    executionId: `round-job-${input.jobId}`,
    symbol: snapshot.currentSymbol,
    stage: "round-runtime",
    status: "RUNNING",
    level: "INFO",
    message: snapshot.message,
    context: {
      jobId: input.jobId,
      runId: input.runId,
      roundNo: input.roundNo,
      runtime: snapshot,
    },
  });

  return snapshot;
}

export function readRuntimeFromMetadata(metadata: Record<string, unknown> | null | undefined): RoundRuntimeSnapshot | null {
  const runtime = metadata?.runtime;
  if (!runtime || typeof runtime !== "object") return null;
  return runtime as RoundRuntimeSnapshot;
}

export function summarizeRuntimeMetrics(jobs: Array<{ metadata?: unknown; rounds?: Array<{ metadata?: unknown; startedAt?: Date; endedAt?: Date | null }> }>) {
  const heartbeats: number[] = [];
  let maxBlockingMs = 0;
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    const runtime = readRuntimeFromMetadata((job.metadata as Record<string, unknown> | null) ?? null);
    if (runtime?.timeline) {
      const hb = runtime.timeline.filter((x) => x.kind === "heartbeat");
      heartbeats.push(hb.length);
    }
    for (const run of job.rounds ?? []) {
      const runRuntime = readRuntimeFromMetadata((run.metadata as Record<string, unknown> | null) ?? null);
      if (runRuntime?.elapsedMs) maxBlockingMs = Math.max(maxBlockingMs, runRuntime.elapsedMs);
      if (run.endedAt) {
        if (runRuntime?.step === "ROUND_FAILED" || runRuntime?.step === "TIMEOUT") failed += 1;
        else completed += 1;
      }
    }
  }
  return {
    avgHeartbeatEvents: heartbeats.length ? heartbeats.reduce((a, b) => a + b, 0) / heartbeats.length : 0,
    maxObservedBlockingMs: maxBlockingMs,
    completedRounds: completed,
    failedRounds: failed,
  };
}
