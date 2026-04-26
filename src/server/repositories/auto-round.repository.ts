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
      endedAt: input.endedAt,
      metadata: input.metadata as never,
    },
  });
}

export async function listAutoRoundJobs(userId: string, limit = 10) {
  return prisma.autoRoundJob.findMany({
    where: { userId },
    include: {
      rounds: {
        orderBy: { roundNo: "desc" },
        take: 100,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
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
