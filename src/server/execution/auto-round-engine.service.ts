import { logger } from "@/lib/logger";
import { listPersistedExecutionEvents, publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { closePositionManually, executeAnalyzeAndTrade } from "@/src/server/execution/execution-orchestrator.service";
import { getBestFastEntry } from "@/src/server/scanner";
import {
  createAutoRoundJob,
  createAutoRoundRun,
  findRunningAutoRoundJob,
  getAutoRoundJobById,
  listAutoRoundJobs,
  listRunningAutoRoundJobs,
  type AutoRoundState,
  updateAutoRoundJob,
  updateAutoRoundRun,
} from "@/src/server/repositories/auto-round.repository";
import { getPositionById, getRuntimeExecutionContext, listOpenPositionsByUser } from "@/src/server/repositories/execution.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { getSafeModeState, persistRoundState } from "@/src/server/recovery/failsafe-recovery.service";

type StartRoundInput = {
  userId?: string;
  totalRounds: number;
  budgetPerTrade: number;
  targetProfitPct: number;
  stopLossPct: number;
  maxWaitSec: number;
  coinSelectionMode: string;
  aiMode: string;
  allowRepeatCoin: boolean;
  mode: "manual" | "auto";
};

const loopRegistry = new Map<string, Promise<void>>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toStateText(state: AutoRoundState) {
  return state.replaceAll("_", " ");
}

async function setJobState(jobId: string, state: AutoRoundState, message: string, context?: Record<string, unknown>) {
  const job = await getAutoRoundJobById(jobId);
  if (!job) return;
  await updateAutoRoundJob({
    jobId,
    activeState: state,
  });
  publishExecutionEvent({
    executionId: `round-job-${jobId}`,
    symbol: undefined,
    stage: "round-engine",
    status: state === "tur_basarisiz" ? "FAILED" : state === "tur_tamamlandi" ? "SUCCESS" : "RUNNING",
    level: state === "tur_basarisiz" ? "ERROR" : "INFO",
    message,
    context: {
      jobId,
      currentRound: job.currentRound,
      totalRounds: job.totalRounds,
      activeState: toStateText(state),
      ...context,
    },
  });
  await writeStructuredLog({
    level: state === "tur_basarisiz" ? "ERROR" : state === "sure_doldu" ? "WARN" : "INFO",
    source: "auto-round-engine",
    message,
    actionType: state === "tur_tamamlandi" ? "round_completed" : "coin_selected",
    status: state === "tur_basarisiz" ? "FAILED" : state === "tur_tamamlandi" ? "SUCCESS" : "RUNNING",
    transactionId: jobId,
    context: {
      state,
      ...context,
    },
  });
  await persistRoundState({
    userId: job.userId,
    jobId,
    roundNo: job.currentRound,
    state,
    symbol: typeof context?.symbol === "string" ? context.symbol : undefined,
    status: state === "tur_basarisiz" ? "FAILED" : state === "tur_tamamlandi" ? "SUCCESS" : "RUNNING",
  }).catch(() => null);
}

async function failRound(input: { jobId: string; runId: string; reason: string }) {
  const job = await getAutoRoundJobById(input.jobId);
  if (!job) return;
  await updateAutoRoundRun({
    runId: input.runId,
    state: "tur_basarisiz",
    failReason: input.reason,
    result: "failed",
    endedAt: new Date(),
  });
  await updateAutoRoundJob({
    jobId: input.jobId,
    failedRounds: job.failedRounds + 1,
    activeState: "tur_basarisiz",
    lastError: input.reason,
  });
  await setJobState(input.jobId, "tur_basarisiz", `Tur basarisiz: ${input.reason}`, {
    reason: input.reason,
  });
}

async function waitPositionClosed(input: {
  jobId: string;
  runId: string;
  positionId: string;
  executionId?: string;
  maxWaitSec: number;
}) {
  const deadline = Date.now() + Math.max(30, input.maxWaitSec) * 1000;
  while (Date.now() < deadline) {
    const position = await getPositionById(input.positionId);
    if (!position) {
      return { ok: false as const, reason: "Pozisyon bulunamadi" };
    }
    if (position.status === "CLOSED") {
      const events = input.executionId
        ? await listPersistedExecutionEvents({ executionId: input.executionId, limit: 25 }).catch(() => [])
        : [];
      const settlement = events.find((row) => row.stage === "settlement" && row.status === "SUCCESS");
      const summary = settlement?.context?.tradeSummary as
        | {
            exitPrice?: number;
            quantity?: number;
            netPnl?: number;
            closeReason?: string;
          }
        | undefined;
      const closeReason = String(summary?.closeReason ?? "");
      const state: AutoRoundState = closeReason === "STOP_LOSS" ? "zarar_durdur_calisti" : "satis_gerceklesti";
      return {
        ok: true as const,
        state,
        sellPrice: Number(summary?.exitPrice ?? position.closePrice ?? 0),
        sellQty: Number(summary?.quantity ?? position.quantity ?? 0),
        netPnl: Number(summary?.netPnl ?? position.realizedPnl ?? 0),
        feeTotal: Number(position.feeTotal ?? 0),
        closeReason: closeReason || "UNKNOWN",
      };
    }
    await sleep(2_000);
  }

  await closePositionManually({
    positionId: input.positionId,
    reason: "MANUAL_CLOSE",
  }).catch(() => null);
  return { ok: false as const, reason: "sure_doldu" };
}

async function runRoundJob(jobId: string) {
  try {
    while (true) {
      const job = await getAutoRoundJobById(jobId);
      if (!job) break;
      if (job.stopRequested) {
        await updateAutoRoundJob({
          jobId,
          status: "STOPPED",
          activeState: "bekliyor",
          finishedAt: new Date(),
          lastError: null,
        });
        await setJobState(jobId, "bekliyor", "Tur motoru kullanici tarafindan durduruldu");
        break;
      }
      const doneCount = job.completedRounds + job.failedRounds;
      if (doneCount >= job.totalRounds) {
        await updateAutoRoundJob({
          jobId,
          status: "COMPLETED",
          activeState: "tur_tamamlandi",
          finishedAt: new Date(),
        });
        await setJobState(jobId, "tur_tamamlandi", "Tum hedef turlar tamamlandi");
        break;
      }

      const roundNo = doneCount + 1;
      await updateAutoRoundJob({
        jobId,
        currentRound: roundNo,
        activeState: "tariyor",
      });
      const run = await createAutoRoundRun({
        jobId,
        roundNo,
        state: "tariyor",
        metadata: {
          targetProfitPct: job.targetProfitPct,
          stopLossPct: job.stopLossPct,
          maxWaitSec: job.maxWaitSec,
          budgetPerTrade: job.budgetPerTrade,
        },
      });
      await setJobState(jobId, "tariyor", `Tur ${roundNo}/${job.totalRounds}: piyasa taraniyor`);

      const openPositions = await listOpenPositionsByUser(job.userId);
      if (openPositions.length > 0) {
        await failRound({
          jobId,
          runId: run.id,
          reason: "Acik pozisyon varken yeni tur baslatilamaz",
        });
        continue;
      }

      const best = await getBestFastEntry();
      const selected = best.selected;
      if (!selected) {
        await failRound({
          jobId,
          runId: run.id,
          reason: best.reason ?? "Uygun coin secilemedi",
        });
        continue;
      }
      const symbol = selected.context.symbol.toUpperCase();
      const usedSymbols =
        ((job.metadata as { usedSymbols?: string[] } | null)?.usedSymbols ?? []).map((x) => String(x).toUpperCase());
      if (!job.allowRepeatCoin && usedSymbols.includes(symbol)) {
        await failRound({
          jobId,
          runId: run.id,
          reason: `${symbol} tekrar alimi engellendi`,
        });
        continue;
      }

      await updateAutoRoundRun({
        runId: run.id,
        state: "coin_secildi",
        symbol,
        selectedReason: selected.ai?.explanation ?? "scanner + ai consensus",
      });
      await setJobState(jobId, "coin_secildi", `Tur ${roundNo}: ${symbol} secildi`, {
        selectedReason: selected.ai?.explanation,
      });

      const execution = await executeAnalyzeAndTrade({
        requestedSymbol: symbol,
        requestedQuoteAmountTry: job.budgetPerTrade,
        takeProfitPercent: job.targetProfitPct,
        stopLossPercent: job.stopLossPct,
        maxDurationSec: job.maxWaitSec,
      });
      if (!execution?.opened || !execution.positionId) {
        await failRound({
          jobId,
          runId: run.id,
          reason: execution?.rejectReason ?? "Alim acilisi basarisiz",
        });
        continue;
      }

      await updateAutoRoundRun({
        runId: run.id,
        state: "alim_yapildi",
        executionId: execution.executionId,
        buyPrice: Number(execution.details?.entryPrice ?? 0),
        buyQty: Number(execution.details?.filledQuantity ?? 0),
      });
      await setJobState(jobId, "alim_yapildi", `Tur ${roundNo}: alim tamamlandi`, {
        symbol,
        executionId: execution.executionId,
        buyPrice: execution.details?.entryPrice,
        buyQty: execution.details?.filledQuantity,
      });

      await updateAutoRoundRun({
        runId: run.id,
        state: "satis_bekleniyor",
      });
      await setJobState(jobId, "satis_bekleniyor", `Tur ${roundNo}: satis bekleniyor`, { symbol });

      const closeResult = await waitPositionClosed({
        jobId,
        runId: run.id,
        positionId: execution.positionId,
        executionId: execution.executionId,
        maxWaitSec: job.maxWaitSec,
      });
      if (!closeResult.ok) {
        const failState: AutoRoundState = closeResult.reason === "sure_doldu" ? "sure_doldu" : "tur_basarisiz";
        await updateAutoRoundRun({
          runId: run.id,
          state: failState,
          failReason: closeResult.reason,
          result: "failed",
          endedAt: new Date(),
        });
        const refreshed = await getAutoRoundJobById(jobId);
        if (refreshed) {
          await updateAutoRoundJob({
            jobId,
            failedRounds: refreshed.failedRounds + 1,
            activeState: failState,
            lastError: closeResult.reason,
          });
        }
        await setJobState(jobId, failState, `Tur ${roundNo}: ${closeResult.reason}`, { symbol });
        continue;
      }

      await updateAutoRoundRun({
        runId: run.id,
        state: closeResult.state,
        sellPrice: closeResult.sellPrice,
        sellQty: closeResult.sellQty,
        netPnl: closeResult.netPnl,
        feeTotal: closeResult.feeTotal,
        result: closeResult.netPnl >= 0 ? "profit" : "loss",
        endedAt: new Date(),
        metadata: {
          closeReason: closeResult.closeReason,
        },
      });
      const nextUsed = job.allowRepeatCoin ? usedSymbols : [...usedSymbols, symbol];
      await updateAutoRoundJob({
        jobId,
        completedRounds: job.completedRounds + 1,
        activeState: "tur_tamamlandi",
        metadata: {
          ...(job.metadata as Record<string, unknown> | null),
          usedSymbols: nextUsed,
        },
      });
      await setJobState(jobId, "tur_tamamlandi", `Tur ${roundNo} tamamlandi`, {
        symbol,
        netPnl: closeResult.netPnl,
        closeReason: closeResult.closeReason,
      });
    }
  } catch (error) {
    logger.error({ error: (error as Error).message, jobId }, "Auto round engine failed");
    await updateAutoRoundJob({
      jobId,
      status: "FAILED",
      activeState: "tur_basarisiz",
      lastError: (error as Error).message,
      finishedAt: new Date(),
    }).catch(() => null);
    await setJobState(jobId, "tur_basarisiz", `Tur motoru hata: ${(error as Error).message}`);
  }
}

function spawnJobLoop(jobId: string) {
  if (loopRegistry.has(jobId)) return;
  const runner = runRoundJob(jobId).finally(() => {
    loopRegistry.delete(jobId);
  });
  loopRegistry.set(jobId, runner);
}

export async function startAutoRoundJob(input: StartRoundInput) {
  const { user } = await getRuntimeExecutionContext(input.userId);
  const safeMode = await getSafeModeState(user.id);
  if (safeMode.enabled) {
    return {
      started: false,
      reason: safeMode.reason ?? "Safe mode active",
      job: null,
    };
  }
  const running = await findRunningAutoRoundJob(user.id);
  if (running) {
    spawnJobLoop(running.id);
    return {
      started: false,
      reason: "Halihazirda aktif bir tur motoru var",
      job: running,
    };
  }
  const job = await createAutoRoundJob({
    userId: user.id,
    totalRounds: input.totalRounds,
    budgetPerTrade: input.budgetPerTrade,
    targetProfitPct: input.targetProfitPct,
    stopLossPct: input.stopLossPct,
    maxWaitSec: input.maxWaitSec,
    coinSelectionMode: input.coinSelectionMode,
    aiMode: input.aiMode,
    allowRepeatCoin: input.allowRepeatCoin,
    mode: input.mode,
  });
  await setJobState(job.id, "bekliyor", "Tur motoru baslatildi", {
    totalRounds: job.totalRounds,
    budgetPerTrade: job.budgetPerTrade,
    targetProfitPct: job.targetProfitPct,
    stopLossPct: job.stopLossPct,
    maxWaitSec: job.maxWaitSec,
  });
  spawnJobLoop(job.id);
  return {
    started: true,
    jobId: job.id,
  };
}

export async function stopAutoRoundJob(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  const running = await findRunningAutoRoundJob(user.id);
  if (!running) {
    return { stopped: false, reason: "Aktif tur motoru yok" };
  }
  await updateAutoRoundJob({
    jobId: running.id,
    stopRequested: true,
    activeState: "bekliyor",
  });
  await setJobState(running.id, "bekliyor", "Tur motoru durdurma istegi aldi");
  return {
    stopped: true,
    jobId: running.id,
  };
}

export async function getAutoRoundStatus(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  const running = await findRunningAutoRoundJob(user.id);
  if (running) spawnJobLoop(running.id);
  const recentJobs = await listAutoRoundJobs(user.id, 8);
  return {
    active: running ?? null,
    jobs: recentJobs,
  };
}

export async function ensureAutoRoundRecovery() {
  const jobs = await listRunningAutoRoundJobs(20);
  for (const job of jobs) {
    spawnJobLoop(job.id);
  }
}
