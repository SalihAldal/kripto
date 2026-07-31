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
  getPositionById: vi.fn().mockResolvedValue({
    id: "pos-x",
    status: "CLOSED",
    closePrice: 112,
    quantity: 1,
    realizedPnl: 2.5,
    feeTotal: 0.2,
  }),
}));

vi.mock("@/src/server/scanner", () => ({
  getBestFastEntry: vi.fn().mockResolvedValue({
    selected: {
      context: { symbol: "BTCTRY" },
      ai: { explanation: "consensus strong buy" },
    },
    reason: undefined,
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
    const row: Run = {
      id: `run-${Math.random().toString(36).slice(2, 8)}`,
      jobId: String(payload.jobId),
      roundNo: Number(payload.roundNo),
      state: String(payload.state),
      metadata: (payload.metadata as Record<string, unknown>) ?? null,
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
}));

describe("auto round engine integration", () => {
  it("10 tur otomatik donguyu tamamlar ve ikinci start istegini engeller", async () => {
    const mod = await import("../src/server/execution/auto-round-engine.service");
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
    expect(done?.status).toBe("COMPLETED");
    expect(done?.completedRounds).toBe(10);
    expect(Array.from(runs.values()).filter((x) => x.jobId === done?.id).length).toBe(10);
  });
});
