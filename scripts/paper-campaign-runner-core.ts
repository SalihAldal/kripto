/**
 * Shared PAPER campaign runner core — preflight, job lifecycle, checkpoints, terminal wait.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { PaperProgressWatchdog, type PaperProgressRuntimeEvidence } from "../src/server/forensics/paper-progress-watchdog";
import { capturePaperStrategySnapshot } from "../src/server/forensics/paper-strategy-freeze.service";

export type PaperCampaignRunnerConfig = {
  durationMs: number;
  campaignId: string;
  artifactRoot: string;
  resultFile: string;
  heartbeatMs: number;
  pollMs: number;
  maxWaitSec: number;
  budgetPerTrade: number;
  terminalWaitMs: number;
};

export function loadEnvFile() {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (!(k in process.env)) process.env[k] = v;
  }
  process.env.EXECUTION_MODE = "paper";
  process.env.LIVE_TRADING_ENABLED = "false";
  process.env.LIVE_TRADING_ACK = "false";
  process.env.LIVE_AUTHORIZATION = "DISABLED";
  process.env.CANONICAL_RUNTIME_ENFORCE_NO_LEGACY_PERSIST = "true";
  process.env.PAPER_STRATEGY_FREEZE_ENABLED = "true";
}

export function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function appendCheckpoint(artifactRoot: string, event: Record<string, unknown>) {
  const checkpointPath = path.join(artifactRoot, "checkpoints.jsonl");
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.appendFileSync(checkpointPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function readPaperCashSnapshot(userId: string) {
  const { ensurePaperAccountInitialized } = await import("@/src/server/simulation/paper-trading.service");
  const account = await ensurePaperAccountInitialized(userId);
  return account.balances;
}

async function waitForJobTerminal(jobId: string, userId: string, timeoutMs: number) {
  const { prisma } = await import("@/src/server/db/prisma");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await prisma.autoRoundJob.findUnique({
      where: { id: jobId },
      include: { rounds: { where: { endedAt: null }, take: 1 } },
    });
    const openRound = job?.rounds?.[0];
    if (job && job.status !== "RUNNING" && !openRound) {
      return { job, reachedTerminal: true };
    }
    await sleep(2_000);
  }
  const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
  return { job, reachedTerminal: false };
}

async function reconcileOrphanPaperJob(userId: string, jobId: string, artifactRoot: string, reason: string) {
  const { stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");
  appendCheckpoint(artifactRoot, { type: "RUNNER_FATAL_RECONCILE", jobId, reason });
  try {
    await stopAutoRoundJob(userId);
  } catch (error) {
    appendCheckpoint(artifactRoot, {
      type: "RUNNER_FATAL_RECONCILE_ERROR",
      jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId }, select: { status: true } });
  appendCheckpoint(artifactRoot, { type: "RUNNER_FATAL_RECONCILE_DONE", jobId, status: job?.status ?? null });
}

export async function runPaperCampaign(config: PaperCampaignRunnerConfig) {
  if (process.env.EXECUTION_MODE !== "paper" || process.env.LIVE_TRADING_ENABLED !== "false") throw new Error("PAPER_RUNNER_MODE_REQUIRED");
  const wallClockStartMs = Date.now();
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const configSnapshot = {
    EXECUTION_MODE: process.env.EXECUTION_MODE,
    LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED,
    LIVE_AUTHORIZATION: process.env.LIVE_AUTHORIZATION,
    PAPER_INITIAL_BALANCE_TRY: process.env.PAPER_INITIAL_BALANCE_TRY ?? null,
    DURATION_MS: config.durationMs,
    CAMPAIGN_ID: config.campaignId,
    BUDGET_PER_TRADE: config.budgetPerTrade,
    MAX_WAIT_SEC: config.maxWaitSec,
  };
  const configHash = createHash("sha256").update(JSON.stringify(configSnapshot)).digest("hex");
  writeJson(path.join(config.artifactRoot, "frozen-config.json"), { ...configSnapshot, configHash });

  const preflightStartedAt = Date.now();
  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${config.campaignId}-preflight`,
  });
  const preflightMs = Date.now() - preflightStartedAt;
  writeJson(path.join(config.artifactRoot, "preflight.json"), { ...preflight, preflightDurationMs: preflightMs });
  if (!preflight.canStart) {
    const blocked = {
      campaignId: config.campaignId,
      phase: "PREFLIGHT_BLOCKED",
      preflight,
      endedAt: new Date().toISOString(),
    };
    writeJson(path.resolve(config.resultFile), blocked);
    await prisma.$disconnect();
    return blocked;
  }

  const { ensurePaperAccountInitialized } = await import("@/src/server/simulation/paper-trading.service");
  await ensurePaperAccountInitialized(user.id);
  const strategySnapshot = capturePaperStrategySnapshot();
  writeJson(path.join(config.artifactRoot, "frozen-strategy-snapshot.json"), strategySnapshot);
  const paperCashBefore = await readPaperCashSnapshot(user.id);
  const openPositionsBefore = await prisma.position.count({ where: { userId: user.id, status: "OPEN" } });

  const jobStartedAtMs = Date.now();
  const deadlineMs = jobStartedAtMs + config.durationMs;
  let stopReason: "deadline" | "signal" | "job_stopped" | "technical_stall" | "runner_fatal" = "deadline";
  let gracefulStopRequested = false;
  let activeJobId: string | null = null;
  let activeUserId: string | null = null;
  const onSignal = () => {
    gracefulStopRequested = true;
    stopReason = "signal";
  };
  const onFatal = async (label: string, error: unknown) => {
    appendCheckpoint(config.artifactRoot, {
      type: "RUNNER_FATAL",
      label,
      message: error instanceof Error ? error.message : String(error),
      jobId: activeJobId,
    });
    if (activeJobId && activeUserId) {
      await reconcileOrphanPaperJob(activeUserId, activeJobId, config.artifactRoot, label);
    }
    stopReason = "runner_fatal";
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("uncaughtException", (error) => {
    void onFatal("uncaughtException", error).finally(() => process.exit(1));
  });
  process.on("unhandledRejection", (error) => {
    void onFatal("unhandledRejection", error).finally(() => process.exit(1));
  });

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 10_000,
    budgetPerTrade: config.budgetPerTrade,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: config.maxWaitSec,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });
  const jobId = "jobId" in started ? started.jobId : null;
  activeJobId = jobId;
  activeUserId = user.id;
  if (!started.started || !jobId) {
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
    const fail = { campaignId: config.campaignId, phase: "START_FAILED", started };
    writeJson(path.resolve(config.resultFile), fail);
    await prisma.$disconnect();
    return fail;
  }

  try {
    const metadata = JSON.stringify({ campaignId: `cmp:${jobId}`, paperCampaignId: config.campaignId, configHash });
    // Atomic merge: do not erase scheduler/runtime metadata written while starting.
    await prisma.$executeRaw`UPDATE "AutoRoundJob" SET "metadata" = COALESCE("metadata", '{}'::jsonb) || ${metadata}::jsonb WHERE "id" = ${jobId}`;
  } catch (error) {
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
    await stopAutoRoundJob(user.id);
    await prisma.$disconnect();
    throw error;
  }

  appendCheckpoint(config.artifactRoot, {
    type: "JOB_START",
    jobId,
    campaignId: config.campaignId,
    userId: user.id,
    preflightMs,
    durationMs: config.durationMs,
  });

  let lastHeartbeat = 0;
  const progressWatchdog = new PaperProgressWatchdog(jobStartedAtMs);
  let progressFailure: string | null = null;
  try {
  while (Date.now() < deadlineMs && !gracefulStopRequested) {
    const now = Date.now();
    if (now - lastHeartbeat >= config.heartbeatMs) {
      const status = await getAutoRoundStatus(user.id).catch(() => null);
      const openPositions = await prisma.position.count({ where: { userId: user.id, status: "OPEN" } });
      const recentRounds = await prisma.autoRoundRun.findMany({
        where: { jobId },
        orderBy: { roundNo: "desc" },
        take: 5,
        select: { id: true, state: true, endedAt: true, failReason: true, startedAt: true, metadata: true },
      });
      const activeRound = recentRounds.find((round) => !round.endedAt) ?? recentRounds[0];
      const runtimeMeta = ((activeRound?.metadata ?? {}) as Record<string, unknown>).runtime as Record<string, unknown> | undefined;
      const runtime: PaperProgressRuntimeEvidence | null = activeRound
        ? {
            scannerSymbolsProcessed: Number(runtimeMeta?.scannerSymbolsProcessed ?? 0),
            candidatesProcessed: Number(runtimeMeta?.candidatesProcessed ?? 0),
            selectionAttempt: Number(runtimeMeta?.selectionAttempt ?? 0),
            step: typeof runtimeMeta?.step === "string" ? runtimeMeta.step : undefined,
            selectionBudgetMs: Number(runtimeMeta?.selectionBudgetMs ?? 0) || undefined,
            selectionStartedAtMs: activeRound.startedAt?.getTime(),
          }
        : null;
      const progress = progressWatchdog.observe({ nowMs: now, openPositions, rounds: recentRounds, runtime });
      appendCheckpoint(config.artifactRoot, { type: "PROGRESS_CHECK", ...progress });
      if (progress.shouldStop) { progressFailure = progress.reason; stopReason = "technical_stall"; break; }
      appendCheckpoint(config.artifactRoot, {
        type: "HEARTBEAT",
        elapsedMs: now - jobStartedAtMs,
        remainingMs: deadlineMs - now,
        jobStatus: status?.active?.id === jobId ? status.active.status : null,
        openPositions,
      });
      lastHeartbeat = now;
    }
    const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
    if (job && job.status !== "RUNNING") {
      stopReason = "job_stopped";
      break;
    }
    await sleep(config.pollMs);
  }
  } catch (error) {
    stopReason = "technical_stall";
    progressFailure = error instanceof Error ? error.message : String(error);
    if (activeJobId && activeUserId) {
      await reconcileOrphanPaperJob(activeUserId, activeJobId, config.artifactRoot, progressFailure);
    }
  }
  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  appendCheckpoint(config.artifactRoot, {
    type: "STOP_REQUESTED",
    jobId,
    stopReason,
    gracefulStopRequested,
    elapsedMs: Date.now() - jobStartedAtMs,
  });

  let stopError: string | null = null;
  try {
    await stopAutoRoundJob(user.id);
  } catch (error) {
    stopError = error instanceof Error ? error.message : String(error);
  }

  const terminal = await waitForJobTerminal(jobId, user.id, config.terminalWaitMs);
  const endedAtMs = Date.now();
  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  const campaignCmpId = `cmp:${jobId}`;
  const campaignClosedPaper = await prisma.paperTrade.findMany({
    where: {
      userId: user.id,
      status: "CLOSED",
      OR: [{ campaignId: config.campaignId }, { campaignId: campaignCmpId }],
    },
  });
  const openPositions = await prisma.position.findMany({
    where: { userId: user.id, status: "OPEN" },
    select: { id: true, quantity: true, entryPrice: true, unrealizedPnl: true, metadata: true, openedAt: true },
  });
  const campaignOpenPositions = openPositions.filter((p) => {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    return (
      meta.campaignId === config.campaignId ||
      meta.campaignId === campaignCmpId ||
      meta.sessionId === jobId
    );
  });

  const realizedPnl = campaignClosedPaper.reduce((s, r) => s + Number(r.realizedPnl ?? 0), 0);
  const unrealizedPnl = campaignOpenPositions.reduce((s, r) => s + Number(r.unrealizedPnl ?? 0), 0);
  const paperCashAfter = await readPaperCashSnapshot(user.id);

  const result = {
    campaignId: config.campaignId,
    jobId,
    wallClockStartedAt: new Date(wallClockStartMs).toISOString(),
    jobStartedAt: new Date(jobStartedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    preflightDurationMs: preflightMs,
    plannedDurationMs: config.durationMs,
    actualJobDurationMs: endedAtMs - jobStartedAtMs,
    completedFullDuration: endedAtMs - jobStartedAtMs >= config.durationMs - config.pollMs,
    gracefulStopRequested,
    stopReason,
    stopError,
    progressFailure,
    reachedTerminal: terminal.reachedTerminal,
    configHash,
    frozenConfig: configSnapshot,
    roundsCompleted: finalJob?.rounds?.filter((r) => r.endedAt != null && r.state !== "tariyor").length ?? 0,
    roundsRecorded: finalJob?.rounds?.length ?? 0,
    roundReasonCounts: (finalJob?.rounds ?? []).reduce<Record<string, number>>((counts, round) => {
      const reason = round.failReason ?? round.result ?? round.state;
      counts[reason] = (counts[reason] ?? 0) + 1; return counts;
    }, {}),
    tradeCount: campaignClosedPaper.length,
    openPositionCount: campaignOpenPositions.length,
    realizedPnl,
    unrealizedPnl,
    netEquityDelta: realizedPnl + unrealizedPnl,
    paperCashBefore,
    paperCashAfter,
    openPositionsBefore,
    openPositions: campaignOpenPositions,
    finalJobStatus: finalJob?.status ?? null,
    artifactRoot: config.artifactRoot,
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED,
    executionMode: process.env.EXECUTION_MODE,
  };

  appendCheckpoint(config.artifactRoot, {
    type: "FINAL",
    jobId,
    reachedTerminal: terminal.reachedTerminal,
    finalJobStatus: finalJob?.status ?? null,
    tradeCount: campaignClosedPaper.length,
  });

  writeJson(path.join(config.artifactRoot, "final-snapshot.json"), result);
  writeJson(path.resolve(config.resultFile), result);

  try {
    const { buildPaperCampaignSummary } = await import("@/src/server/forensics/paper-campaign-summary.service");
    const summary = await buildPaperCampaignSummary({
      campaignId: config.campaignId,
      jobId,
      userId: user.id,
      startedAt: result.jobStartedAt,
      endedAt: result.endedAt,
      paperCashBefore: result.paperCashBefore,
    });
    writeJson(path.join(config.artifactRoot, "paper-campaign-summary.json"), summary);
  } catch (summaryError) {
    appendCheckpoint(config.artifactRoot, {
      type: "SUMMARY_ERROR",
      message: summaryError instanceof Error ? summaryError.message : String(summaryError),
    });
  }

  await prisma.$disconnect();
  return result;
}
