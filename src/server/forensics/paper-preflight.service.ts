import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { getProviderConfigs } from "@/src/server/ai/provider-registry";
import { resolveRoundWatchdogStaleMs } from "@/src/server/execution/cooperative-async.service";
import {
  getProcessOwnerId,
  getSchedulerLeaseSnapshot,
  getSchedulerRegistrySnapshot,
  hasLocalSchedulerLoop,
  isSchedulerLeaseLive,
  isSchedulerLeaseStale,
} from "@/src/server/execution/scheduler-ownership.service";
import { readRuntimeFromMetadata } from "@/src/server/execution/round-runtime.service";
import { getActiveRoundOwnershipForJob } from "@/src/server/execution/round-registry.service";
import { prisma } from "@/src/server/db/prisma";
import { PaperDbUnavailableError, validatePaperDbHealth } from "@/src/server/forensics/db-health.service";
import { resolveRuntimeConfigSnapshot } from "@/src/server/forensics/resolved-config.service";
import { runEngineSanityChecks } from "@/src/server/forensics/engine-sanity.service";
import type {
  PaperJobReconciliationRecord,
  PaperPreflightArtifact,
  PaperRoundReconciliationRecord,
  PreflightCheckResult,
  PreflightOverallVerdict,
} from "@/src/server/forensics/forensic.types";
import {
  findRunningAutoRoundJob,
  getAutoRoundJobById,
  listRunningAutoRoundJobs,
  loadSchedulerLease,
  type AutoRoundState,
  updateAutoRoundJob,
  updateAutoRoundRun,
} from "@/src/server/repositories/auto-round.repository";
import { getEmergencyStopState } from "@/src/server/repositories/execution.repository";
import { getTicker } from "@/services/binance.service";
import { evaluateClockSync, persistClockSyncForensics } from "@/src/server/execution-safety/clock-sync.service";
import {
  assessSafeModeExecutionGate,
  describeSafeModeAckRequirement,
} from "@/src/server/recovery/paper-safe-mode-policy.service";

const IN_PROGRESS_ROUND_STATES: AutoRoundState[] = ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"];

function nowIso() {
  return new Date().toISOString();
}

function checkResult(
  status: PreflightCheckResult["status"],
  reasonCode: string,
  reasonDetail: string,
  metadata?: Record<string, unknown>,
): PreflightCheckResult {
  return { status, reasonCode, reasonDetail, timestamp: nowIso(), metadata };
}

function isPaperJob(job: { aiMode: string }) {
  return job.aiMode.toLowerCase() === "learning" || env.EXECUTION_MODE === "paper";
}

function assessJobSchedulerActivity(jobId: string, dbLease: Awaited<ReturnType<typeof loadSchedulerLease>>) {
  const hasLocalLoop = hasLocalSchedulerLoop(jobId);
  const localLease = getSchedulerLeaseSnapshot(jobId);
  const lease = localLease ?? dbLease;

  if (hasLocalLoop) {
    return {
      active: true,
      peerOwned: false,
      reasonCode: "SCHEDULER_ACTIVE_LOCAL",
      evidence: { hasLocalLoop, leaseOwnerId: lease?.ownerId ?? null, leaseState: lease?.state ?? null },
    };
  }

  if (lease && lease.ownerId === getProcessOwnerId() && isSchedulerLeaseLive(lease)) {
    return {
      active: true,
      peerOwned: false,
      reasonCode: "SCHEDULER_ACTIVE_LOCAL",
      evidence: { hasLocalLoop: false, leaseOwnerId: lease.ownerId, leaseState: lease.state },
    };
  }

  if (
    lease &&
    lease.ownerId !== getProcessOwnerId() &&
    isSchedulerLeaseLive(lease) &&
    hasLocalSchedulerLoop(jobId)
  ) {
    return {
      active: true,
      peerOwned: true,
      reasonCode: "SCHEDULER_ACTIVE_PEER",
      evidence: { leaseOwnerId: lease.ownerId, leaseState: lease.state },
    };
  }

  return {
    active: false,
    peerOwned: false,
    reasonCode: isSchedulerLeaseStale(lease) ? "SCHEDULER_LEASE_STALE" : "SCHEDULER_ORPHANED",
    evidence: { leaseOwnerId: lease?.ownerId ?? null, leaseState: lease?.state ?? null },
  };
}

function assessRoundActivityEvidence(input: {
  run: { id: string; state: string; startedAt: Date; metadata?: unknown };
  jobSchedulerActive: boolean;
  jobId: string;
}) {
  const ownership = getActiveRoundOwnershipForJob(input.jobId).find((row) => row.runId === input.run.id);
  if (ownership && input.jobSchedulerActive) {
    return {
      active: true,
      reasonCode: "ROUND_OWNERSHIP_ACTIVE",
      evidence: { ownershipStatus: ownership.status, roundOwner: ownership.roundOwner },
    };
  }

  const runtime = readRuntimeFromMetadata((input.run.metadata as Record<string, unknown> | null) ?? null);
  const heartbeatAt = runtime?.heartbeatAt ? String(runtime.heartbeatAt) : "";
  const staleMs = resolveRoundWatchdogStaleMs();
  if (input.jobSchedulerActive && heartbeatAt) {
    const ageMs = Date.now() - new Date(heartbeatAt).getTime();
    if (Number.isFinite(ageMs) && ageMs <= staleMs) {
      return {
        active: true,
        reasonCode: "ROUND_HEARTBEAT_FRESH",
        evidence: { heartbeatAt, ageMs },
      };
    }
  }

  if (input.jobSchedulerActive) {
    const startedAgeMs = Date.now() - new Date(input.run.startedAt).getTime();
    if (input.run.state === "tariyor" && Number.isFinite(startedAgeMs) && startedAgeMs <= staleMs) {
      return {
        active: true,
        reasonCode: "ROUND_RECENTLY_STARTED",
        evidence: { startedAgeMs, state: input.run.state },
      };
    }
  }

  return {
    active: false,
    reasonCode: heartbeatAt ? "ROUND_HEARTBEAT_WITHOUT_SCHEDULER" : "ROUND_NO_LIVE_EVIDENCE",
    evidence: { heartbeatAt: heartbeatAt || null, state: input.run.state, jobSchedulerActive: input.jobSchedulerActive },
  };
}

function resolveReconciledRoundTerminalState(state: string): { state: AutoRoundState; result: string } {
  if (state === "satis_bekleniyor") {
    return { state: "sure_doldu", result: "failed" };
  }
  if (state === "satis_gerceklesti" || state === "tur_tamamlandi") {
    return { state: "tur_tamamlandi", result: "success" };
  }
  return { state: "tur_basarisiz", result: "failed" };
}

async function reconcileStaleJob(input: {
  jobId: string;
  reasonCode: string;
  reasonDetail: string;
}): Promise<{ jobRecord: PaperJobReconciliationRecord | null; roundRecords: PaperRoundReconciliationRecord[] }> {
  const job = await getAutoRoundJobById(input.jobId);
  if (!job || job.status !== "RUNNING") {
    return { jobRecord: null, roundRecords: [] };
  }

  const dbLease = await loadSchedulerLease(input.jobId);
  const scheduler = assessJobSchedulerActivity(input.jobId, dbLease);
  if (scheduler.active) {
    return { jobRecord: null, roundRecords: [] };
  }

  const roundRecords: PaperRoundReconciliationRecord[] = [];
  const timestamp = nowIso();
  let failedInc = 0;

  for (const run of job.rounds ?? []) {
    if (!IN_PROGRESS_ROUND_STATES.includes(run.state as AutoRoundState) || run.endedAt) continue;
    const activity = assessRoundActivityEvidence({
      run,
      jobSchedulerActive: false,
      jobId: job.id,
    });
    if (activity.active) continue;

    const terminal = resolveReconciledRoundTerminalState(run.state);
    const detail = `${input.reasonDetail}; prior=${run.state}; evidence=${JSON.stringify(activity.evidence)}`;
    await updateAutoRoundRun({
      runId: run.id,
      state: terminal.state,
      failReason: detail,
      result: terminal.result,
      endedAt: new Date(),
      metadata: {
        ...(((run.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
        preflightReconciledAt: timestamp,
        preflightReasonCode: input.reasonCode,
      },
    });
    if (terminal.result === "failed") failedInc += 1;
    roundRecords.push({
      roundId: run.id,
      jobId: job.id,
      previousState: run.state,
      newState: terminal.state,
      reasonCode: input.reasonCode,
      reasonDetail: detail,
      timestamp,
    });
  }

  await updateAutoRoundJob({
    jobId: job.id,
    status: "STOPPED",
    stopRequested: true,
    activeState: "bekliyor",
    finishedAt: new Date(),
    failedRounds: job.failedRounds + failedInc,
    lastError: input.reasonDetail,
    activeRunId: null,
  });

  const jobRecord: PaperJobReconciliationRecord = {
    jobId: job.id,
    previousStatus: job.status,
    newStatus: "STOPPED",
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    timestamp,
  };

  return { jobRecord, roundRecords };
}

async function listZombieRoundCandidates(userId: string) {
  return prisma.autoRoundRun.findMany({
    where: {
      endedAt: null,
      state: { in: IN_PROGRESS_ROUND_STATES },
      job: { userId },
    },
    include: {
      job: {
        select: {
          id: true,
          status: true,
          aiMode: true,
          stopRequested: true,
        },
      },
    },
    orderBy: { startedAt: "asc" },
    take: 100,
  });
}

async function reconcileZombieRound(run: Awaited<ReturnType<typeof listZombieRoundCandidates>>[number]): Promise<PaperRoundReconciliationRecord | null> {
  if (run.endedAt || !IN_PROGRESS_ROUND_STATES.includes(run.state as AutoRoundState)) return null;

  const dbLease = await loadSchedulerLease(run.jobId);
  const scheduler = assessJobSchedulerActivity(run.jobId, dbLease);
  const activity = assessRoundActivityEvidence({
    run,
    jobSchedulerActive: scheduler.active,
    jobId: run.jobId,
  });
  if (activity.active) return null;

  const terminal = resolveReconciledRoundTerminalState(run.state);
  const timestamp = nowIso();
  const reasonCode = "PREFLIGHT_ZOMBIE_ROUND_RECONCILED";
  const reasonDetail = `Zombie round reconciled before paper start; prior=${run.state}; scheduler=${scheduler.reasonCode}; round=${activity.reasonCode}`;
  await updateAutoRoundRun({
    runId: run.id,
    state: terminal.state,
    failReason: reasonDetail,
    result: terminal.result,
    endedAt: new Date(),
    metadata: {
      ...(((run.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>),
      preflightReconciledAt: timestamp,
      preflightReasonCode: reasonCode,
    },
  });

  if (run.job.status === "RUNNING" && !scheduler.active) {
    const job = await getAutoRoundJobById(run.jobId);
    if (job) {
      await updateAutoRoundJob({
        jobId: run.jobId,
        failedRounds: terminal.result === "failed" ? job.failedRounds + 1 : job.failedRounds,
        activeRunId: null,
        lastError: reasonDetail,
      }).catch(() => null);
    }
  }

  return {
    roundId: run.id,
    jobId: run.jobId,
    previousState: run.state,
    newState: terminal.state,
    reasonCode,
    reasonDetail,
    timestamp,
  };
}

function writePreflightArtifact(artifact: PaperPreflightArtifact) {
  const rootDir = path.join(process.cwd(), "artifacts", "forensics", "preflight", artifact.attemptId);
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(path.join(rootDir, "preflight.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  if (artifact.clockSync.metadata) {
    writeFileSync(
      path.join(rootDir, "clock-sync-forensics.json"),
      `${JSON.stringify({ ...artifact.clockSync.metadata, persistedAt: artifact.generatedAt, attemptId: artifact.attemptId }, null, 2)}\n`,
      "utf8",
    );
  }
  return rootDir;
}

export type PaperPreflightResult = PaperPreflightArtifact & {
  artifactPath: string;
};

export async function runPaperSessionPreflight(input: {
  userId: string;
  attemptId?: string;
}): Promise<PaperPreflightResult> {
  const attemptId = input.attemptId ?? `preflight-${nowIso().replace(/[:.]/g, "-")}`;
  const reconciledRounds: PaperRoundReconciliationRecord[] = [];
  const reconciledJobs: PaperJobReconciliationRecord[] = [];

  let database = checkResult("FAIL", "PENDING", "Database check pending");
  try {
    await validatePaperDbHealth();
    database = checkResult("PASS", "DB_HEALTHY", "PostgreSQL reachable and AutoRound schema accessible");
  } catch (error) {
    const message = error instanceof PaperDbUnavailableError ? error.message : (error as Error).message;
    database = checkResult("FAIL", "PAPER_DB_UNAVAILABLE", message);
  }

  let binance = checkResult("FAIL", "PENDING", "Binance TR check pending");
  if (database.status !== "FAIL") {
    try {
      const probeSymbol = env.BINANCE_PLATFORM === "tr" ? "BTCTRY" : "BTCUSDT";
      const ticker = await getTicker(probeSymbol, "high");
      const price = Number(ticker.price);
      if (!Number.isFinite(price) || price <= 0) {
        binance = checkResult("FAIL", "BINANCE_INVALID_TICKER", `Ticker ${probeSymbol} returned invalid price`, { price });
      } else {
        binance = checkResult("PASS", "BINANCE_TR_HEALTHY", `${probeSymbol} ticker ok (${price})`, {
          symbol: probeSymbol,
          price,
        });
      }
    } catch (error) {
      binance = checkResult("FAIL", "BINANCE_UNREACHABLE", (error as Error).message || "Binance TR request failed");
    }
  } else {
    binance = checkResult("WARN", "BINANCE_SKIPPED", "Skipped Binance check because database preflight failed");
  }

  let clockSync = checkResult("FAIL", "PENDING", "Clock sync check pending");
  if (database.status !== "FAIL") {
    try {
      const clock = await evaluateClockSync();
      persistClockSyncForensics(clock.forensics, { sessionId: attemptId });
      const metadata = {
        localTime: clock.forensics.localTime,
        serverTime: clock.forensics.serverTime,
        clockOffsetMs: clock.forensics.clockOffsetMs,
        clockSkewMs: clock.forensics.clockSkewMs,
        apiLatencyMs: clock.forensics.measuredLatencyMs,
        skewThresholdMs: clock.forensics.skewThresholdMs,
        endpoint: clock.forensics.endpoint,
        timestampSource: clock.forensics.timestampSource,
      };
      if (!clock.ok) {
        clockSync = checkResult(
          "FAIL",
          "CLOCK_SKEW_ENVIRONMENT",
          `Clock skew ${clock.skewMs}ms exceeds threshold ${clock.forensics.skewThresholdMs}ms`,
          metadata,
        );
      } else {
        clockSync = checkResult("PASS", "CLOCK_SYNC_OK", `Clock skew ${clock.skewMs}ms within threshold`, metadata);
      }
    } catch (error) {
      clockSync = checkResult("FAIL", "CLOCK_SYNC_ERROR", (error as Error).message || "Clock sync probe failed");
    }
  } else {
    clockSync = checkResult("WARN", "CLOCK_SYNC_SKIPPED", "Skipped clock sync because database preflight failed");
  }

  const providers = getProviderConfigs();
  const remoteRequired = Boolean(
    process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY,
  );
  const ai =
    providers.length === 0
      ? checkResult(
          "FAIL",
          "AI_PROVIDERS_MISSING",
          remoteRequired
            ? "No enabled AI providers; remote keys present but none configured"
            : "No enabled AI providers configured",
          { enabledProviders: providers.map((row) => row.id), remoteRequired },
        )
      : checkResult("PASS", "AI_CONFIGURED", `${providers.length} enabled AI provider(s)`, {
          providers: providers.map((row) => ({ id: row.id, name: row.name, model: row.model })),
          remoteRequired,
        });

  const safeModeGate = await assessSafeModeExecutionGate(input.userId);
  const safeModeAck = describeSafeModeAckRequirement(safeModeGate);
  const safeMode = safeModeGate.blocked
    ? checkResult(
        "FAIL",
        safeModeGate.failureCode,
        safeModeGate.reasonDetail,
        {
          failureDomain: safeModeGate.failureDomain,
          requireManualAck: safeModeGate.requireManualAck,
          breakerOpen: safeModeGate.breakerOpen,
          ack: safeModeAck,
        },
      )
    : checkResult("PASS", "SAFE_MODE_CLEAR", "Safe mode and execution breaker allow paper startup");

  const emergencyStopActive = await getEmergencyStopState(input.userId);
  const emergencyStop = emergencyStopActive
    ? checkResult(
        "WARN",
        "EMERGENCY_STOP_ACTIVE",
        "Emergency stop is active for live trading, but native Paper sessions bypass this safety gate by policy",
        {
          blocksLiveTrading: true,
          blocksPaper: false,
          policy: "resolveTradingPauseState(paperMode=true) skips emergency stop",
        },
      )
    : checkResult("PASS", "EMERGENCY_STOP_INACTIVE", "Emergency stop inactive");

  let workerLocks = checkResult("PASS", "WORKER_LOCKS_CLEAR", "No active paper worker locks detected", {
    registry: getSchedulerRegistrySnapshot(),
  });

  const runningJobs = (await listRunningAutoRoundJobs(50)).filter((row) => row.userId === input.userId);
  let peerActiveJob: (typeof runningJobs)[number] | null = null;

  for (const job of runningJobs) {
    const dbLease = await loadSchedulerLease(job.id);
    const scheduler = assessJobSchedulerActivity(job.id, dbLease);
    if (scheduler.peerOwned) {
      peerActiveJob = job;
      continue;
    }
    if (scheduler.active) continue;
    const { jobRecord, roundRecords } = await reconcileStaleJob({
      jobId: job.id,
      reasonCode: "PREFLIGHT_STALE_RUNNING_JOB",
      reasonDetail: `Stale RUNNING job reconciled before paper start (${scheduler.reasonCode})`,
    });
    if (jobRecord) reconciledJobs.push(jobRecord);
    reconciledRounds.push(...roundRecords);
  }

  const zombieCandidates = database.status === "FAIL" ? [] : await listZombieRoundCandidates(input.userId);
  for (const run of zombieCandidates) {
    const record = await reconcileZombieRound(run);
    if (record) reconciledRounds.push(record);
  }

  const remainingRunning = await findRunningAutoRoundJob(input.userId);
  let activeJobs = checkResult("PASS", "NO_ACTIVE_JOB", "No RUNNING auto-round job blocking startup");
  if (peerActiveJob) {
    activeJobs = checkResult("FAIL", "PEER_JOB_ACTIVE", "Another process holds a live scheduler loop for a RUNNING job", {
      jobId: peerActiveJob.id,
    });
  } else if (remainingRunning) {
    const dbLease = await loadSchedulerLease(remainingRunning.id);
    const scheduler = assessJobSchedulerActivity(remainingRunning.id, dbLease);
    activeJobs = checkResult(
      scheduler.active ? "FAIL" : "WARN",
      scheduler.active ? "ACTIVE_JOB_REMAINS" : "RUNNING_JOB_REMAINING",
      scheduler.active
        ? "RUNNING job still has live scheduler evidence after reconciliation"
        : "RUNNING job record remains but scheduler evidence is stale; manual review may be required",
      { jobId: remainingRunning.id, scheduler: scheduler.reasonCode, evidence: scheduler.evidence },
    );
  }

  const remainingZombies = database.status === "FAIL" ? zombieCandidates.length : (await listZombieRoundCandidates(input.userId)).length;
  const zombieRounds =
    remainingZombies === 0
      ? checkResult(
          reconciledRounds.length > 0 ? "WARN" : "PASS",
          reconciledRounds.length > 0 ? "ZOMBIE_ROUNDS_RECONCILED" : "NO_ZOMBIE_ROUNDS",
          reconciledRounds.length > 0
            ? `Reconciled ${reconciledRounds.length} stale round record(s) before startup`
            : "No in-progress rounds with endedAt=null blocking startup",
          { reconciledCount: reconciledRounds.length },
        )
      : checkResult("FAIL", "ZOMBIE_ROUNDS_REMAIN", `${remainingZombies} in-progress round(s) still appear active`, {
          remainingZombies,
        });

  const registry = getSchedulerRegistrySnapshot();
  const staleLocalLoops = registry.loops.filter((row) => !hasLocalSchedulerLoop(row.jobId));
  workerLocks = checkResult(
    registry.loopCount > 0 ? "WARN" : "PASS",
    registry.loopCount > 0 ? "LOCAL_SCHEDULER_LOOPS" : "WORKER_LOCKS_CLEAR",
    registry.loopCount > 0
      ? `${registry.loopCount} local scheduler loop(s) registered in this process`
      : "No local scheduler loops registered",
    { registry, staleLocalLoops: staleLocalLoops.length },
  );

  const remainingPaperJobs = (await listRunningAutoRoundJobs(50)).filter(
    (row) => row.userId === input.userId && isPaperJob(row),
  );
  const duplicatePaperJobs =
    remainingPaperJobs.length > 1
      ? checkResult("FAIL", "DUPLICATE_PAPER_JOBS", `${remainingPaperJobs.length} RUNNING paper jobs for user`, {
          jobIds: remainingPaperJobs.map((row) => row.id),
        })
      : checkResult("PASS", "NO_DUPLICATE_PAPER_JOBS", "At most one RUNNING paper job for user");

  let resolvedConfig = checkResult("FAIL", "PENDING", "Resolved config pending");
  try {
    const snapshot = await resolveRuntimeConfigSnapshot(input.userId);
    const executionMode = String(snapshot.aiMode.executionMode ?? env.EXECUTION_MODE);
    resolvedConfig = checkResult(
      executionMode === "paper" ? "PASS" : "WARN",
      executionMode === "paper" ? "PAPER_CONFIG_OK" : "EXECUTION_MODE_NOT_PAPER",
      executionMode === "paper"
        ? "Resolved runtime config confirms paper execution mode"
        : `Resolved execution mode is ${executionMode}; paper job still allowed via aiMode=learning`,
      { executionMode, exchange: snapshot.exchange },
    );
  } catch (error) {
    resolvedConfig = checkResult("FAIL", "RESOLVED_CONFIG_ERROR", (error as Error).message || "Config resolution failed");
  }

  const engineSanityReport = runEngineSanityChecks();
  const engineSanity = engineSanityReport.ok
    ? checkResult("PASS", "ENGINE_SANITY_OK", "Hybrid engine and data-contract modules verified")
    : checkResult(
        "FAIL",
        "ENGINE_SANITY_FAIL",
        engineSanityReport.checks
          .filter((row) => row.status === "FAIL")
          .map((row) => row.reasonDetail)
          .join(" | "),
        { checks: engineSanityReport.checks },
      );

  const blockingChecks = [database, binance, clockSync, ai, engineSanity, safeMode, activeJobs, zombieRounds, duplicatePaperJobs, resolvedConfig].filter(
    (row) => row.status === "FAIL",
  );
  const warnChecks = [emergencyStop, workerLocks, zombieRounds, resolvedConfig, activeJobs].filter(
    (row) => row.status === "WARN",
  );

  let overallVerdict: PreflightOverallVerdict = "READY";
  if (blockingChecks.length > 0) {
    overallVerdict = "BLOCKED";
  } else if (warnChecks.length > 0 || reconciledJobs.length > 0 || reconciledRounds.length > 0) {
    overallVerdict = "DEGRADED";
  }

  const canStart = overallVerdict !== "BLOCKED";
  const blockReason = blockingChecks[0]?.reasonDetail ?? null;
  const blockCode = blockingChecks[0]?.reasonCode ?? null;

  const artifact: PaperPreflightArtifact = {
    attemptId,
    userId: input.userId,
    generatedAt: nowIso(),
    overallVerdict,
    canStart,
    blockReason,
    blockCode,
    database,
    binance,
    ai,
    emergencyStop,
    activeJobs,
    zombieRounds,
    workerLocks,
    resolvedConfig,
    duplicatePaperJobs,
    clockSync,
    reconciledRounds,
    reconciledJobs,
  };

  const artifactPath = writePreflightArtifact(artifact);
  return { ...artifact, artifactPath };
}

export { PaperDbUnavailableError };
