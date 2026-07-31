import { prisma } from "@/src/server/db/prisma";

export type AutoRoundState =
  | "bekliyor"
  | "tariyor"
  | "coin_secildi"
  | "alim_yapildi"
  | "satis_bekleniyor"
  | "satis_gerceklesti"
  | "zarar_durdur_calisti"
  | "sure_doldu"
  | "tur_basarisiz"
  | "tur_tamamlandi";

export async function findStoppableAutoRoundJob(userId: string) {
  return prisma.autoRoundJob.findFirst({
    where: {
      userId,
      status: "RUNNING",
    },
    include: {
      rounds: {
        orderBy: { roundNo: "desc" },
        take: 30,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findRunningAutoRoundJob(userId: string) {
  return prisma.autoRoundJob.findFirst({
    where: {
      userId,
      status: "RUNNING",
      stopRequested: false,
    },
    include: {
      rounds: {
        orderBy: { roundNo: "desc" },
        take: 30,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAutoRoundJobById(jobId: string) {
  return prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: {
      rounds: {
        orderBy: { roundNo: "desc" },
      },
    },
  });
}

export async function createAutoRoundJob(input: {
  userId: string;
  totalRounds: number;
  budgetPerTrade: number;
  targetProfitPct: number;
  stopLossPct: number;
  maxWaitSec: number;
  coinSelectionMode: string;
  aiMode: string;
  allowRepeatCoin: boolean;
  mode: "manual" | "auto";
}) {
  return prisma.autoRoundJob.create({
    data: {
      userId: input.userId,
      status: "RUNNING",
      totalRounds: input.totalRounds,
      budgetPerTrade: input.budgetPerTrade,
      targetProfitPct: input.targetProfitPct,
      stopLossPct: input.stopLossPct,
      maxWaitSec: input.maxWaitSec,
      coinSelectionMode: input.coinSelectionMode,
      aiMode: input.aiMode,
      allowRepeatCoin: input.allowRepeatCoin,
      mode: input.mode,
      startedAt: new Date(),
      activeState: "bekliyor",
      metadata: {
        usedSymbols: [],
      },
    },
  });
}

export async function updateAutoRoundJob(input: {
  jobId: string;
  status?: string;
  completedRounds?: number;
  failedRounds?: number;
  currentRound?: number;
  activeState?: AutoRoundState;
  stopRequested?: boolean;
  lastError?: string | null;
  finishedAt?: Date | null;
  metadata?: Record<string, unknown>;
}) {
  return prisma.autoRoundJob.update({
    where: { id: input.jobId },
    data: {
      status: input.status,
      completedRounds: input.completedRounds,
      failedRounds: input.failedRounds,
      currentRound: input.currentRound,
      activeState: input.activeState,
      stopRequested: input.stopRequested,
      lastError: input.lastError,
      finishedAt: input.finishedAt,
      metadata: input.metadata as never,
    },
  });
}

export async function createAutoRoundRun(input: {
  jobId: string;
  roundNo: number;
  state: AutoRoundState;
  symbol?: string;
  executionId?: string;
  selectedReason?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.autoRoundRun.create({
    data: {
      jobId: input.jobId,
      roundNo: input.roundNo,
      state: input.state,
      symbol: input.symbol,
      executionId: input.executionId,
      selectedReason: input.selectedReason,
      metadata: input.metadata as never,
    },
  });
}

export async function updateAutoRoundRun(input: {
  runId: string;
  state?: AutoRoundState;
  symbol?: string;
  executionId?: string;
  buyPrice?: number;
  buyQty?: number;
  sellPrice?: number;
  sellQty?: number;
  netPnl?: number;
  feeTotal?: number;
  result?: string;
  failReason?: string;
  selectedReason?: string;
  endedAt?: Date;
  metadata?: Record<string, unknown>;
}) {
  return prisma.autoRoundRun.update({
    where: { id: input.runId },
    data: {
      state: input.state,
      symbol: input.symbol,
      executionId: input.executionId,
      buyPrice: input.buyPrice,
      buyQty: input.buyQty,
      sellPrice: input.sellPrice,
      sellQty: input.sellQty,
      netPnl: input.netPnl,
      feeTotal: input.feeTotal,
      result: input.result,
      failReason: input.failReason,
      selectedReason: input.selectedReason,
      endedAt: input.endedAt,
      metadata: input.metadata as never,
    },
  });
}

export async function getAutoRoundRunById(runId: string) {
  return prisma.autoRoundRun.findUnique({
    where: { id: runId },
    include: {
      job: true,
    },
  });
}

export async function deleteAutoRoundRun(runId: string) {
  return prisma.autoRoundRun.delete({
    where: { id: runId },
  });
}

export async function listAutoRoundJobs(userId: string, limit = 10) {
  return prisma.autoRoundJob.findMany({
    where: { userId },
    include: {
      rounds: {
        orderBy: { roundNo: "desc" },
        take: 500,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getAutoRoundJobStats(jobId: string) {
  const [openedRounds, rejectedCount, successCount, failedCount, pnlAgg] = await Promise.all([
    prisma.autoRoundRun.count({
      where: { jobId, buyPrice: { gt: 0 }, buyQty: { gt: 0 } },
    }),
    prisma.autoRoundRun.count({
      where: { jobId, state: "tur_basarisiz" },
    }),
    prisma.autoRoundRun.count({
      where: { jobId, result: "profit" },
    }),
    prisma.autoRoundRun.count({
      where: { jobId, result: "loss" },
    }),
    prisma.autoRoundRun.aggregate({
      where: { jobId, netPnl: { not: null } },
      _sum: { netPnl: true, feeTotal: true },
    }),
  ]);
  const openedRuns = await prisma.autoRoundRun.findMany({
    where: { jobId, buyPrice: { gt: 0 }, buyQty: { gt: 0 } },
    select: { buyPrice: true, buyQty: true },
  });
  const entryNotional = openedRuns.reduce((sum, row) => sum + Number(row.buyPrice ?? 0) * Number(row.buyQty ?? 0), 0);
  const netPnl = Number(pnlAgg._sum.netPnl ?? 0);
  return {
    openedRounds,
    rejectedCount,
    successCount,
    failedCount,
    netPnl,
    feeTotal: Number(pnlAgg._sum.feeTotal ?? 0),
    entryNotional,
    netPnlPercent: entryNotional > 0 ? (netPnl / entryNotional) * 100 : 0,
    winRate: successCount + failedCount > 0 ? (successCount / (successCount + failedCount)) * 100 : 0,
  };
}

export async function listRunningAutoRoundJobs(limit = 20) {
  return prisma.autoRoundJob.findMany({
    where: {
      status: "RUNNING",
      stopRequested: false,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
}

export type AutoRoundHistoryFilter = "all" | "opened" | "rejected";

function buildAutoRoundHistoryWhere(input: {
  userId: string;
  filter: AutoRoundHistoryFilter;
  jobId?: string;
}) {
  return {
    job: { userId: input.userId },
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.filter === "opened"
      ? { buyPrice: { gt: 0 }, buyQty: { gt: 0 } }
      : input.filter === "rejected"
        ? { state: "tur_basarisiz" as const }
        : {}),
  };
}

export async function getAutoRoundRunFilterCounts(userId: string, jobId?: string) {
  const base = { job: { userId }, ...(jobId ? { jobId } : {}) };
  const [all, opened, rejected] = await Promise.all([
    prisma.autoRoundRun.count({ where: base }),
    prisma.autoRoundRun.count({ where: { ...base, buyPrice: { gt: 0 }, buyQty: { gt: 0 } } }),
    prisma.autoRoundRun.count({ where: { ...base, state: "tur_basarisiz" } }),
  ]);
  return { all, opened, rejected };
}

export async function listAutoRoundRunsPaginated(input: {
  userId: string;
  page: number;
  pageSize: number;
  filter: AutoRoundHistoryFilter;
  jobId?: string;
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(50, Math.max(1, input.pageSize));
  const where = buildAutoRoundHistoryWhere(input);
  const [total, runs] = await Promise.all([
    prisma.autoRoundRun.count({ where }),
    prisma.autoRoundRun.findMany({
      where,
      orderBy: [{ startedAt: "desc" }, { roundNo: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        job: {
          select: {
            id: true,
            status: true,
            totalRounds: true,
            currentRound: true,
          },
        },
      },
    }),
  ]);
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;
  return { total, page, pageSize, totalPages, runs };
}
