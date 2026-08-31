import { describe, expect, it, vi } from "vitest";

type Job = {
  id: string;
  userId: string;
  status: string;
  totalRounds: number;
  completedRounds: number;
  failedRounds: number;
  currentRound: number;
  budgetPerTrade: number;
  targetProfitPct: number;
  stopLossPct: number;
  maxWaitSec: number;
  coinSelectionMode: string;
  aiMode: string;
  allowRepeatCoin: boolean;
  mode: string;
  activeState: string;
  stopRequested: boolean;
  lastError: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

type Run = {
  id: string;
  jobId: string;
  roundNo: number;
  state: string;
  symbol?: string | null;
  executionId?: string | null;
  buyPrice?: number | null;
  buyQty?: number | null;
  sellPrice?: number | null;
  sellQty?: number | null;
  netPnl?: number | null;
  feeTotal?: number | null;
  result?: string | null;
  failReason?: string | null;
  selectedReason?: string | null;
  metadata?: Record<string, unknown> | null;
  startedAt?: Date;
  endedAt?: Date | null;
};

const jobs = new Map<string, Job>();
const runs = new Map<string, Run>();
let seq = 0;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock("@/src/server/repositories/execution.repository", () => ({
  getRuntimeExecutionContext: vi.fn().mockResolvedValue({ user: { id: "u-1" } }),
  listOpenPositionsByUser: vi.fn().mockResolvedValue([]),
  getEmergencyStopState: vi.fn().mockResolvedValue(false),
  getPositionById: vi.fn().mockResolvedValue({
    id: "pos-x",
    status: "CLOSED",
    closePrice: 112,
    quantity: 1,
    realizedPnl: 2.5,
    feeTotal: 0.2,
  }),
}));

const mockCandidate = {
  context: {
    symbol: "BTCTRY",
    metadata: {},
    spreadPercent: 0.1,
    fakeSpikeScore: 0,
    pumpRisk: 10,
    change24h: 1,
    momentumPercent: 0.5,
    volatilityPercent: 0.2,
    volume24h: 1_000_000,
    tradable: true,
    rejectReasons: [],
    lastPrice: 100,
  },
  ai: {
    explanation: "consensus strong buy",
    finalConfidence: 80,
    finalDecision: "BUY",
    rejected: false,
    analysisScorecard: { confidenceScore: 80 },
  },
  score: { score: 80, confidence: 80, status: "OK" },
  rank: 1,
};

vi.mock("@/src/server/scanner", () => ({
  getBestFastEntry: vi.fn().mockResolvedValue({
    selected: mockCandidate,
    reason: undefined,
    scannedAt: new Date().toISOString(),
    evaluated: 1,
  }),
  getPumpFastEntry: vi.fn().mockResolvedValue({
    selected: mockCandidate,
    reason: "Pump lane",
    scannedAt: new Date().toISOString(),
    evaluated: 1,
  }),
}));

vi.mock("@/src/server/execution/execution-orchestrator.service", () => ({
  executeAnalyzeAndTrade: vi.fn().mockImplementation(async () => {
    seq += 1;
    return {
      opened: true,
      positionId: `pos-${seq}`,
      executionId: `exec-${seq}`,
      details: { entryPrice: 110 + seq, filledQuantity: 1 },
    };
  }),
  closePositionManually: vi.fn().mockResolvedValue({ closed: true }),
  ensureOpenPositionMonitors: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/src/server/execution/execution-event-bus", () => ({
  publishExecutionEvent: vi.fn(),
  listPersistedExecutionEvents: vi.fn().mockResolvedValue([
    {
      stage: "settlement",
      status: "SUCCESS",
      context: {
        tradeSummary: {
          exitPrice: 112,
          quantity: 1,
          netPnl: 2.5,
          closeReason: "TAKE_PROFIT",
        },
      },
    },
  ]),
}));

vi.mock("@/src/server/repositories/auto-round.repository", () => ({
  findRunningAutoRoundJob: vi.fn(async (userId: string) => {
    for (const row of jobs.values()) {
      if (row.userId === userId && row.status === "RUNNING") return row;
    }
    return null;
  }),
  getAutoRoundJobById: vi.fn(async (jobId: string) => {
    const job = jobs.get(jobId);
    if (!job) return null;
    return {
      ...job,
      rounds: Array.from(runs.values()).filter((x) => x.jobId === jobId),
    };
  }),
  listAutoRoundJobs: vi.fn(async (userId: string) =>
    Array.from(jobs.values()).filter((x) => x.userId === userId),
  ),
  listRunningAutoRoundJobs: vi.fn(async () =>
    Array.from(jobs.values()).filter((x) => x.status === "RUNNING"),
  ),
  createAutoRoundJob: vi.fn(async (payload: Record<string, unknown>) => {
    seq += 1;
    const row: Job = {
      id: `job-${seq}`,
      userId: String(payload.userId),
      status: "RUNNING",
      totalRounds: Number(payload.totalRounds),
      completedRounds: 0,
      failedRounds: 0,
      currentRound: 0,
      budgetPerTrade: Number(payload.budgetPerTrade),
      targetProfitPct: Number(payload.targetProfitPct),
      stopLossPct: Number(payload.stopLossPct),
      maxWaitSec: Number(payload.maxWaitSec),
      coinSelectionMode: String(payload.coinSelectionMode),
      aiMode: String(payload.aiMode),
      allowRepeatCoin: Boolean(payload.allowRepeatCoin),
      mode: String(payload.mode),
      activeState: "bekliyor",
      stopRequested: false,
      lastError: null,
      metadata: null,
      startedAt: new Date(),
      finishedAt: null,
    };
    jobs.set(row.id, row);
    return row;
  }),
  updateAutoRoundJob: vi.fn(async (payload: Record<string, unknown>) => {
    const jobId = String(payload.jobId);
    const prev = jobs.get(jobId);
    if (!prev) return null;
    const next = {
      ...prev,
      ...payload,
      lastError: payload.lastError === null ? null : (payload.lastError as string | undefined) ?? prev.lastError,
    } as Job;
    jobs.set(jobId, next);
    return next;
  }),
  createAutoRoundRun: vi.fn(async (payload: Record<string, unknown>) => {
    const row: Run & { startedAt: Date } = {
      id: `run-${Math.random().toString(36).slice(2, 8)}`,
      jobId: String(payload.jobId),
      roundNo: Number(payload.roundNo),
      state: String(payload.state),
      metadata: (payload.metadata as Record<string, unknown>) ?? null,
      startedAt: new Date(),
    };
    runs.set(row.id, row);
    return row;
  }),
  updateAutoRoundRun: vi.fn(async (payload: Record<string, unknown>) => {
    const runId = String(payload.runId);
    const prev = runs.get(runId);
    if (!prev) return null;
    const next = { ...prev, ...payload } as Run;
    runs.set(runId, next);
    return next;
  }),
  getAutoRoundRunById: vi.fn(async (runId: string) => runs.get(runId) ?? null),
  getAutoRoundJobStats: vi.fn(async () => ({
    openedRounds: 0,
    successCount: 0,
    failedCount: 0,
    rejectedCount: 0,
    netPnl: 0,
    feeTotal: 0,
    entryNotional: 0,
    netPnlPercent: 0,
    winRate: 0,
  })),
  listAutoRoundRunsPaginated: vi.fn(async () => ({ runs: [], total: 0, page: 1, pageSize: 5, totalPages: 0 })),
  getAutoRoundRunFilterCounts: vi.fn(async () => ({ all: 0, opened: 0, rejected: 0 })),
  loadSchedulerLease: vi.fn(async () => null),
  compareAndSetSchedulerLease: vi.fn(async (input: { lease: Record<string, unknown> }) => ({
    ok: true,
    lease: { ...input.lease, version: Number(input.lease.version ?? 0) + 1 },
  })),
  acquireOrCreateRoundRun: vi.fn(async (payload: Record<string, unknown>) => {
    const row: Run & { startedAt: Date } = {
      id: `run-${Math.random().toString(36).slice(2, 8)}`,
      jobId: String(payload.jobId),
      roundNo: Number(payload.roundNo),
      state: String(payload.state),
      metadata: (payload.metadata as Record<string, unknown>) ?? null,
      startedAt: new Date(),
    };
    const existing = Array.from(runs.values()).find(
      (x) =>
        x.jobId === row.jobId &&
        x.roundNo === row.roundNo &&
        !x.endedAt &&
        ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"].includes(x.state),
    );
    if (existing) return { action: "attached", run: existing };
    runs.set(row.id, row);
    return { action: "created", run: row };
  }),
  persistRoundOwnershipRecord: vi.fn(async (input: { record: Record<string, unknown> }) => input.record),
}));

vi.mock("@/src/server/execution/scheduler-watchdog.service", () => ({
  atomicStartSchedulerWatchdog: vi.fn(async (jobId: string) => ({ action: "started", jobId })),
  stopSchedulerWatchdog: vi.fn(() => true),
  getWatchdogRegistrySnapshot: vi.fn(() => ({ activeCount: 0, entries: [] })),
  resetSchedulerWatchdogForTests: vi.fn(),
}));

vi.mock("@/src/server/execution/scheduler-recovery.service", () => ({
  configureSchedulerRecovery: vi.fn(),
  executeSchedulerRecoveryForRunningJobs: vi.fn(async () => []),
  executeSchedulerRecovery: vi.fn(async () => ({
    jobId: "job-1",
    action: "NO_ACTION",
    result: "skipped",
    decision: { action: "NO_ACTION", reason: "mock", failure: "SCHEDULER_CRASH", component: "scheduler", escalationLevel: 0, safeResume: true },
    auditEvent: { id: "mock", timestamp: new Date().toISOString(), jobId: "job-1", component: "scheduler", failure: "SCHEDULER_CRASH", decision: {}, action: "NO_ACTION", result: "skipped", durationMs: 0, operator: "automatic", trigger: "startup" },
  })),
  getProductionHealthSnapshot: vi.fn(async () => ({
    generatedAt: new Date().toISOString(),
    overallScore: 100,
    schedulerHealth: 100,
    runtimeHealth: 100,
    recoveryHealth: 100,
    watchdogHealth: 100,
    scannerHealth: 100,
    aiHealth: 100,
    databaseHealth: 100,
    ownershipHealth: 100,
    heartbeatHealth: 100,
    leaseHealth: 100,
    registryHealth: 100,
    jobs: [],
    watchdog: { activeCount: 0, entries: [] },
    recoveryManager: { processOwnerId: "test", pendingRecoveries: 0 },
  })),
  getRecoveryTimeline: vi.fn(async () => []),
}));

vi.mock("@/src/server/repositories/auto-round-integrity.repository", () => ({
  OptimisticConcurrencyError: class OptimisticConcurrencyError extends Error {},
  transactionallyFailRound: vi.fn(async (input: Record<string, unknown>) => {
    const jobId = String(input.jobId);
    const runId = String(input.runId);
    const job = jobs.get(jobId);
    const run = runs.get(runId);
    if (!run) return { ok: false, action: "missing" };
    if (run.endedAt) return { ok: true, action: "already_terminal", run };
    runs.set(runId, {
      ...run,
      state: String(input.activeState ?? "tur_basarisiz"),
      failReason: String(input.reason),
      result: "failed",
      endedAt: new Date(),
    });
    if (job) {
      jobs.set(jobId, {
        ...job,
        failedRounds: job.failedRounds + 1,
        activeState: String(input.activeState ?? "tur_basarisiz"),
        lastError: String(input.reason),
      });
    }
    return { ok: true, action: "failed", run: runs.get(runId) };
  }),
  transactionallyCompleteRound: vi.fn(async (input: Record<string, unknown>) => {
    const jobId = String(input.jobId);
    const runId = String(input.runId);
    const job = jobs.get(jobId);
    const run = runs.get(runId);
    const runPatch = (input.runPatch ?? {}) as Record<string, unknown>;
    if (!run) return { ok: false, action: "missing" };
    if (run.endedAt && run.result) return { ok: true, action: "already_terminal", run };
    runs.set(runId, {
      ...run,
      ...runPatch,
      endedAt: new Date(),
    });
    if (job) {
      jobs.set(jobId, {
        ...job,
        completedRounds: job.completedRounds + 1,
        activeState: "tur_tamamlandi",
        metadata: {
          ...(job.metadata ?? {}),
          ...((input.jobMetadataPatch as Record<string, unknown> | undefined) ?? {}),
        },
      });
    }
    return { ok: true, action: "completed", run: runs.get(runId) };
  }),
  idempotentMergeRunMetadata: vi.fn(async (input: Record<string, unknown>) => {
    const runId = String(input.runId);
    const run = runs.get(runId);
    if (!run) return { action: "missing" };
    const meta = (run.metadata ?? {}) as Record<string, unknown>;
    runs.set(runId, {
      ...run,
      state: (input.state as string | undefined) ?? run.state,
      symbol: (input.symbol as string | undefined) ?? run.symbol,
      metadata: {
        ...meta,
        ...((input.patch as Record<string, unknown> | undefined) ?? {}),
        ...(input.runtime ? { runtime: input.runtime } : {}),
      },
    });
    return { action: "merged", run: runs.get(runId) };
  }),
  idempotentPatchJobActiveRound: vi.fn(async (input: Record<string, unknown>) => {
    const jobId = String(input.jobId);
    const job = jobs.get(jobId);
    if (!job) return { action: "missing" };
    const meta = (job.metadata ?? {}) as Record<string, unknown>;
    jobs.set(jobId, {
      ...job,
      activeState: (input.activeState as string | undefined) ?? job.activeState,
      metadata: {
        ...meta,
        ...((input.metadataPatch as Record<string, unknown> | undefined) ?? {}),
        activeRound: {
          runId: input.runId,
          roundNo: input.roundNo,
          heartbeatAt: input.heartbeatAt ?? new Date().toISOString(),
          step: input.step,
          message: input.message,
        },
      },
    });
    return { action: "patched" };
  }),
  auditAutoRoundIntegrity: vi.fn(async () => null),
}));

describe("auto round engine integration", () => {
  it("10 tur otomatik donguyu tamamlar ve ikinci start istegini engeller", async () => {
    const mod = await import("../src/server/execution/auto-round-engine.service");
    const ownership = await import("../src/server/execution/scheduler-ownership.service");
    const roundRegistry = await import("../src/server/execution/round-registry.service");
    ownership.resetSchedulerOwnershipForTests();
    roundRegistry.resetRoundRegistryForTests();
    const started = await mod.startAutoRoundJob({
      totalRounds: 10,
      budgetPerTrade: 1000,
      targetProfitPct: 2,
      stopLossPct: 1,
      maxWaitSec: 30,
      coinSelectionMode: "scanner_best",
      aiMode: "consensus",
      allowRepeatCoin: true,
      mode: "auto",
    });
    expect(started.started).toBe(true);

    const second = await mod.startAutoRoundJob({
      totalRounds: 3,
      budgetPerTrade: 500,
      targetProfitPct: 2,
      stopLossPct: 1,
      maxWaitSec: 30,
      coinSelectionMode: "scanner_best",
      aiMode: "consensus",
      allowRepeatCoin: true,
      mode: "auto",
    });
    expect(second.started).toBe(false);

    let safety = 0;
    while (safety < 200) {
      const status = await mod.getAutoRoundStatus();
      if (!status.active) break;
      safety += 1;
      await wait(10);
    }

    const done = Array.from(jobs.values()).find((x) => x.totalRounds === 10);
    expect(done).toBeTruthy();
    expect(["RUNNING", "COMPLETED"]).toContain(done?.status);
    expect(Number(done?.completedRounds ?? 0)).toBeGreaterThanOrEqual(1);
    expect(Array.from(runs.values()).filter((x) => x.jobId === done?.id).length).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
