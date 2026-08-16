/**
 * Live one-round validation for P0 AI cancellation / mid-flight budget fix.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

process.env.EXECUTION_AI_GATE_POLICY = process.env.EXECUTION_AI_GATE_POLICY ?? "VETO";

const VALIDATION_ID = `1round-ai-cancel-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const POLL_MS = 10_000;
const JOB_DEADLINE_MS = 35 * 60_000;
const STARTED_ORPHAN_MS = 180_000;

const TERMINAL_JOB_STATUSES = ["COMPLETED", "FAILED", "STOPPED"];
const TERMINAL_ROUND_STATES = [
  "tur_tamamlandi",
  "tur_basarisiz",
  "sure_doldu",
  "satis_gerceklesti",
  "zarar_durdur_calisti",
];

const REQUIRED_ARTIFACTS = [
  "round-summary.json",
  "ai-progress.json",
  "ai-trace.json",
  "round-watchdog.json",
  "recovery-decisions.json",
  "recovery-telemetry.json",
];

type AiCandidateRow = {
  candidateId?: string;
  symbol?: string;
  provider?: string;
  model?: string;
  executionMode?: string;
  startedAt?: string;
  status?: string;
  completedAt?: string;
  timeoutAt?: string;
  cancelledAt?: string;
  aborted?: boolean;
  signalPropagated?: boolean;
  reasonCode?: string;
  durationMs?: number;
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readRuntime(metadata: unknown) {
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const runtime = meta.runtime;
  if (!runtime || typeof runtime !== "object") return null;
  return runtime as Record<string, unknown>;
}

function fileSha16(relPath: string) {
  const abs = path.join(process.cwd(), relPath);
  if (!fs.existsSync(abs)) return null;
  return createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 16);
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function assessCandidates(candidates: AiCandidateRow[]) {
  const now = Date.now();
  const startedOrphans = candidates.filter((row) => {
    if (row.status !== "STARTED") return false;
    const startedMs = row.startedAt ? new Date(row.startedAt).getTime() : now;
    return now - startedMs > STARTED_ORPHAN_MS;
  });
  const missingForensicStart = candidates.filter(
    (row) => row.status === "STARTED" || row.status === "COMPLETED" || String(row.status).includes("TIMEOUT") || row.status === "AI_FAILED",
  ).filter((row) => !row.provider || !row.model || !row.startedAt);
  const timeoutRows = candidates.filter((row) => row.status === "AI_TIMEOUT" || row.status === "CONSENSUS_TIMEOUT");
  const timeoutForensicIncomplete = timeoutRows.filter(
    (row) => !row.timeoutAt || row.aborted !== true,
  );
  return {
    total: candidates.length,
    startedOrphans,
    missingForensicStart,
    timeoutRows,
    timeoutForensicIncomplete,
  };
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { getRecoveryTelemetryLog } = await import("@/src/server/forensics/recovery-telemetry.service");
  const { getRecoveryTimeline } = await import("@/src/server/execution/scheduler-recovery.service");
  const { assessRoundProgressState } = await import("@/src/server/execution/round-progress-state.service");
  const { getAiBatchProgress } = await import("@/src/server/forensics/ai-runtime.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const startedAt = new Date().toISOString();
  const codeFingerprint = {
    gitHead: gitHead(),
    cancellableWorkSha: fileSha16("src/server/execution/cancellable-work.service.ts"),
    cooperativeAsyncSha: fileSha16("src/server/execution/cooperative-async.service.ts"),
    validationProcessPid: process.pid,
    note: "Validation runner loads current workspace source via tsx — this IS the redeployed cancellation code path",
  };

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  const preflightPath = path.join(process.cwd(), "preflight.json");
  writeJson(preflightPath, { ...preflight, codeFingerprint, validationId: VALIDATION_ID });

  if (!preflight.canStart) {
    const blocked = {
      validationId: VALIDATION_ID,
      verdict: "FAIL",
      phase: "PREFLIGHT_BLOCKED",
      preflightPath,
      preflight,
      codeFingerprint,
      failReasons: ["PREFLIGHT_BLOCKED"],
    };
    writeJson(path.join(process.cwd(), "kripto-one-round-ai-cancellation-validation.json"), blocked);
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const staleRunning = await prisma.autoRoundJob.findFirst({
    where: { userId: user.id, status: "RUNNING" },
    select: { id: true },
  });
  if (staleRunning) {
    await stopAutoRoundJob(user.id).catch(() => null);
    await sleep(3000);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 1,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 600,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  if (!started.started || !started.jobId) {
    const fail = {
      validationId: VALIDATION_ID,
      verdict: "FAIL",
      phase: "START_FAILED",
      started,
      preflightPath,
      codeFingerprint,
      failReasons: ["START_FAILED"],
    };
    writeJson(path.join(process.cwd(), "kripto-one-round-ai-cancellation-validation.json"), fail);
    console.log(JSON.stringify(fail, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  writeJson(path.join(sessionRoot, "preflight.json"), { ...preflight, codeFingerprint });

  const timeline: Array<Record<string, unknown>> = [{ at: new Date().toISOString(), event: "JOB_STARTED", sessionId }];
  const progressSamples: Array<Record<string, unknown>> = [];
  const aiCandidateSnapshots: Array<Record<string, unknown>> = [];
  const recoverySnapshots: Array<Record<string, unknown>> = [];
  let prematureRestartDetected = false;
  let maxStartedOrphanObserved = 0;

  const deadline = Date.now() + JOB_DEADLINE_MS;
  while (Date.now() < deadline) {
    const jobRow = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
    const activeRun = jobRow?.rounds.find((r) => !r.endedAt) ?? jobRow?.rounds[0];
    const runtime = activeRun ? readRuntime(activeRun.metadata) : null;
    const roundId = String(activeRun?.roundNo ?? 1);
    const artifactRoot = path.join(sessionRoot, "rounds", roundId);
    const aiProgressFile = readJson<{ candidates?: AiCandidateRow[]; processed?: number; total?: number }>(
      path.join(artifactRoot, "ai-progress.json"),
    );
    const memBatch = getAiBatchProgress(roundId, activeRun?.id);
    const candidates = aiProgressFile?.candidates ?? memBatch?.candidates ?? [];
    const assessment = assessCandidates(candidates);
    maxStartedOrphanObserved = Math.max(maxStartedOrphanObserved, assessment.startedOrphans.length);

    if (runtime) {
      const progressAssessment = assessRoundProgressState({
        runtime: runtime as never,
        selectionBudgetMs: Number(runtime.selectionBudgetMs ?? 1_200_000),
        selectionStartedAt:
          runtime.elapsedMs != null ? Date.now() - Number(runtime.elapsedMs) : undefined,
      });
      progressSamples.push({
        at: new Date().toISOString(),
        roundNo: activeRun?.roundNo,
        runState: activeRun?.state,
        step: runtime.step,
        elapsedMs: runtime.elapsedMs,
        selectionBudgetMs: runtime.selectionBudgetMs ?? 1_200_000,
        heartbeatAt: runtime.heartbeatAt,
        lastProgressAt: runtime.lastProgressAt,
        aiProcessed: runtime.aiProcessed,
        aiTotal: runtime.aiTotal,
        progressState: progressAssessment.progressState,
        reasonCode: progressAssessment.reasonCode,
        startedOrphans: assessment.startedOrphans.length,
      });

      if (
        ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(progressAssessment.progressState) &&
        Number(runtime.elapsedMs ?? 0) < Number(runtime.selectionBudgetMs ?? 1_200_000) * 0.5 &&
        String(runtime.message ?? "").includes("Recovery restart current stage")
      ) {
        prematureRestartDetected = true;
      }
    }

    aiCandidateSnapshots.push({
      at: new Date().toISOString(),
      roundId,
      runId: activeRun?.id,
      processed: aiProgressFile?.processed ?? memBatch?.processed ?? 0,
      total: aiProgressFile?.total ?? memBatch?.total ?? 0,
      assessment,
      candidates: candidates.map((row) => ({
        candidateId: row.candidateId,
        symbol: row.symbol,
        provider: row.provider,
        model: row.model,
        executionMode: row.executionMode,
        startedAt: row.startedAt,
        status: row.status,
        completedAt: row.completedAt,
        timeoutAt: row.timeoutAt,
        cancelledAt: row.cancelledAt,
        aborted: row.aborted,
        signalPropagated: row.signalPropagated,
        reasonCode: row.reasonCode,
        durationMs: row.durationMs,
      })),
    });

    for (const row of getRecoveryTelemetryLog(100).filter((t) => t.jobId === sessionId)) {
      const key = `${row.timestamp}:${row.recoveryDecision}:${row.reasonCode}`;
      if (!recoverySnapshots.some((s) => s.key === key)) {
        recoverySnapshots.push({ key, ...row });
        if (
          row.recoveryDecision === "RESTART_CURRENT_STAGE" &&
          ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(String(row.progressState))
        ) {
          prematureRestartDetected = true;
        }
      }
    }

    if (jobRow && TERMINAL_JOB_STATUSES.includes(jobRow.status)) break;
    await sleep(POLL_MS);
  }

  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  if (finalJob?.status === "RUNNING") {
    await stopAutoRoundJob(user.id).catch(() => null);
    await sleep(5000);
  }

  const finalJobAfterStop = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  const round1 = finalJobAfterStop?.rounds.find((r) => r.roundNo === 1);
  const artifactRoot = path.join(sessionRoot, "rounds", "1");
  const artifactStatus = Object.fromEntries(
    REQUIRED_ARTIFACTS.map((name) => [name, fs.existsSync(path.join(artifactRoot, name))]),
  );
  const aiProgress = readJson<{ candidates?: AiCandidateRow[] }>(path.join(artifactRoot, "ai-progress.json"));
  const roundSummary = readJson<Record<string, unknown>>(path.join(artifactRoot, "round-summary.json"));
  const recoveryTimeline = await getRecoveryTimeline(sessionId, 100).catch(() => []);

  const finalCandidates = aiProgress?.candidates ?? getAiBatchProgress("1", round1?.id)?.candidates ?? [];
  const candidateAssessment = assessCandidates(finalCandidates);

  const zombieRuns = await prisma.autoRoundRun.count({
    where: {
      jobId: sessionId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const runtimeFinal = round1 ? readRuntime(round1.metadata) : null;
  const roundTerminal = Boolean(round1?.endedAt && TERMINAL_ROUND_STATES.includes(String(round1.state)));
  const jobTerminal = Boolean(finalJobAfterStop && TERMINAL_JOB_STATUSES.includes(finalJobAfterStop.status));
  const selectionBudgetMs = Number(runtimeFinal?.selectionBudgetMs ?? 1_200_000);
  const elapsedMs = Number(runtimeFinal?.elapsedMs ?? 0);
  const budgetRespected = !round1?.endedAt || elapsedMs <= selectionBudgetMs + 120_000 || roundTerminal;

  const failReasons: string[] = [];
  if (candidateAssessment.startedOrphans.length > 0) failReasons.push("STARTED_CANDIDATE_ORPHANS_AT_END");
  if (maxStartedOrphanObserved > 0) failReasons.push(`STARTED_ORPHAN_OBSERVED_DURING_RUN:${maxStartedOrphanObserved}`);
  if (!jobTerminal) failReasons.push("JOB_NOT_TERMINAL");
  if (!roundTerminal) failReasons.push("ROUND_NOT_TERMINAL");
  if (finalJobAfterStop?.status === "RUNNING") failReasons.push("JOB_STILL_RUNNING");
  if (zombieRuns > 0) failReasons.push(`ZOMBIE_RUNS:${zombieRuns}`);
  if (prematureRestartDetected) failReasons.push("PREMATURE_RECOVERY_RESTART");
  if (candidateAssessment.missingForensicStart.length > 0) failReasons.push("MISSING_PROVIDER_MODEL_ON_CANDIDATES");
  for (const [name, ok] of Object.entries(artifactStatus)) {
    if (!ok) failReasons.push(`MISSING_ARTIFACT:${name}`);
  }
  if (candidateAssessment.timeoutForensicIncomplete.length > 0) {
    failReasons.push("TIMEOUT_CANDIDATE_MISSING_FORENSIC_FIELDS");
  }
  if (!budgetRespected) failReasons.push("SELECTION_BUDGET_NOT_ABSOLUTE");

  const verdict =
    failReasons.length === 0 &&
    codeFingerprint.cancellableWorkSha &&
    candidateAssessment.startedOrphans.length === 0
      ? "PASS"
      : "FAIL";

  const result = {
    validationId: VALIDATION_ID,
    referenceFix: "kripto-p0-ai-cancellation-validation.json",
    startedAt,
    completedAt: new Date().toISOString(),
    verdict,
    codeFingerprint,
    config: {
      mode: "PAPER",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      scanner: "REAL_SCANNER",
      ai: "REAL_AI",
      aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
      totalRounds: 1,
      selectionBudgetMs: 1_200_000,
    },
    preflight: {
      path: preflightPath,
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
      reconciledJobs: preflight.reconciledJobs?.length ?? 0,
      reconciledRounds: preflight.reconciledRounds?.length ?? 0,
    },
    sessionId,
    job: finalJobAfterStop
      ? {
          id: finalJobAfterStop.id,
          status: finalJobAfterStop.status,
          completedRounds: finalJobAfterStop.completedRounds,
          failedRounds: finalJobAfterStop.failedRounds,
          lastError: finalJobAfterStop.lastError,
        }
      : null,
    round: round1
      ? {
          roundNo: round1.roundNo,
          runId: round1.id,
          state: round1.state,
          symbol: round1.symbol,
          failReason: round1.failReason,
          startedAt: round1.startedAt,
          endedAt: round1.endedAt,
          durationMs:
            round1.startedAt && round1.endedAt
              ? new Date(round1.endedAt).getTime() - new Date(round1.startedAt).getTime()
              : null,
        }
      : null,
    aiCandidates: {
      processed: aiProgress ? (aiProgress as { processed?: number }).processed : finalCandidates.length,
      total: (aiProgress as { total?: number } | null)?.total ?? null,
      finalAssessment: candidateAssessment,
      snapshots: aiCandidateSnapshots.slice(-20),
    },
    selectionBudget: {
      configuredMs: selectionBudgetMs,
      elapsedMs,
      budgetRespected,
      lastProgressAt: runtimeFinal?.lastProgressAt ?? null,
      heartbeatAt: runtimeFinal?.heartbeatAt ?? null,
    },
    recovery: {
      prematureRestartDetected,
      recoverySnapshots,
      recoveryTimeline: recoveryTimeline.slice(0, 30),
    },
    artifacts: {
      root: artifactRoot,
      status: artifactStatus,
      exportKind: roundSummary?.exportKind ?? null,
    },
    zombieLock: { zombieRuns, jobTerminal, roundTerminal },
    timeline,
    progressSamples: progressSamples.slice(-40),
    failReasons,
  };

  writeJson(path.join(process.cwd(), "kripto-one-round-ai-cancellation-validation.json"), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ validationId: VALIDATION_ID, ok: false, error: (e as Error).message }, null, 2));
  process.exit(1);
});
