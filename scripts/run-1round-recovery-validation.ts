/**
 * Single-round scheduler recovery validation (post P0 fix).
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const VALIDATION_ID = `1round-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const POLL_MS = 10_000;
const JOB_DEADLINE_MS = 35 * 60_000;

const TERMINAL_ROUND_STATES = [
  "tur_tamamlandi",
  "tur_basarisiz",
  "sure_doldu",
  "satis_gerceklesti",
  "zarar_durdur_calisti",
];

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

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { getRecoveryTelemetryLog } = await import("@/src/server/forensics/recovery-telemetry.service");
  const { getRecoveryTimeline } = await import("@/src/server/execution/scheduler-recovery.service");
  const { assessRoundProgressState } = await import("@/src/server/execution/round-progress-state.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const timeline: Array<Record<string, unknown>> = [];
  const startedAt = new Date().toISOString();

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  if (!preflight.canStart) {
    const blocked = { validationId: VALIDATION_ID, phase: "PREFLIGHT_BLOCKED", preflight };
    writeJson(path.join(process.cwd(), "kripto-single-round-recovery-validation.json"), blocked);
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
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
    const fail = { validationId: VALIDATION_ID, phase: "START_FAILED", started, preflight };
    writeJson(path.join(process.cwd(), "kripto-single-round-recovery-validation.json"), fail);
    console.log(JSON.stringify(fail, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  writeJson(path.join(process.cwd(), "artifacts", "forensics", sessionId, "preflight.json"), preflight);
  timeline.push({ at: new Date().toISOString(), event: "JOB_STARTED", sessionId });

  const deadline = Date.now() + JOB_DEADLINE_MS;
  let lastRecoveryCount = -1;
  let prematureRestartDetected = false;
  const progressSamples: Array<Record<string, unknown>> = [];
  const recoverySnapshots: Array<Record<string, unknown>> = [];

  while (Date.now() < deadline) {
    const jobRow = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
    const activeRun = jobRow?.rounds.find((r) => !r.endedAt) ?? jobRow?.rounds[0];
    const runtime = activeRun ? readRuntime(activeRun.metadata) : null;
    const recoveryState = ((jobRow?.metadata as Record<string, unknown> | null)?.recoveryState ?? {}) as Record<
      string,
      unknown
    >;

    if (runtime) {
      const assessment = assessRoundProgressState({
        runtime: runtime as never,
        selectionBudgetMs: Number(runtime.selectionBudgetMs ?? 0) || undefined,
        selectionStartedAt: runtime.elapsedMs != null ? Date.now() - Number(runtime.elapsedMs) : undefined,
      });
      const sample = {
        at: new Date().toISOString(),
        roundNo: activeRun?.roundNo,
        runState: activeRun?.state,
        step: runtime.step,
        elapsedMs: runtime.elapsedMs,
        selectionBudgetMs: runtime.selectionBudgetMs,
        heartbeatAt: runtime.heartbeatAt,
        lastProgressAt: runtime.lastProgressAt,
        aiProcessed: runtime.aiProcessed,
        aiTotal: runtime.aiTotal,
        progressState: assessment.progressState,
        reasonCode: assessment.reasonCode,
        recoveryCount: recoveryState.recoveryCount,
      };
      progressSamples.push(sample);

      if (
        ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(assessment.progressState) &&
        Number(runtime.elapsedMs ?? 0) < Number(runtime.selectionBudgetMs ?? 1_200_000) * 0.5 &&
        (activeRun?.failReason === "Recovery restart current stage" ||
          String(runtime.message ?? "").includes("Recovery restart current stage"))
      ) {
        prematureRestartDetected = true;
      }
    }

    const telemetry = getRecoveryTelemetryLog(200);
    for (const row of telemetry.filter((t) => t.jobId === sessionId)) {
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

    if (Number(recoveryState.recoveryCount ?? 0) !== lastRecoveryCount) {
      timeline.push({
        at: new Date().toISOString(),
        event: "RECOVERY_COUNT_CHANGED",
        recoveryCount: recoveryState.recoveryCount,
        escalationLevel: recoveryState.escalationLevel,
      });
      lastRecoveryCount = Number(recoveryState.recoveryCount ?? 0);
    }

    if (jobRow && jobRow.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  if (finalJob?.status === "RUNNING") {
    await stopAutoRoundJob(user.id).catch(() => null);
  }

  const round1 = finalJob?.rounds.find((r) => r.roundNo === 1);
  const artifactRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", "1");
  const roundSummary = readJson<Record<string, unknown>>(path.join(artifactRoot, "round-summary.json"));
  const recoveryDecisions = readJson<{ records?: Array<Record<string, unknown>> }>(
    path.join(artifactRoot, "recovery-decisions.json"),
  );
  const recoveryTelemetryArtifact = readJson<{ records?: Array<Record<string, unknown>> }>(
    path.join(artifactRoot, "recovery-telemetry.json"),
  );
  const aiProgress = readJson<Record<string, unknown>>(path.join(artifactRoot, "ai-progress.json"));

  const recoveryTimeline = await getRecoveryTimeline(sessionId, 100).catch(() => []);

  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: sessionId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const runtimeFinal = round1 ? readRuntime(round1.metadata) : null;
  const failReason = round1?.failReason ?? null;
  const restartOccurred =
    failReason === "Recovery restart current stage" ||
    recoverySnapshots.some((r) => r.recoveryDecision === "RESTART_CURRENT_STAGE") ||
    recoveryTimeline.some((e) => e.action === "RESTART_CURRENT_STAGE" && e.result === "success");

  const executionReached =
    Boolean(roundSummary?.tradeCount && Number(roundSummary.tradeCount) > 0) ||
    round1?.state === "alim_yapildi" ||
    round1?.state === "satis_bekleniyor" ||
    round1?.state === "satis_gerceklesti" ||
    round1?.state === "tur_tamamlandi";

  const legitimateZeroTrade =
    !executionReached &&
    TERMINAL_ROUND_STATES.includes(String(round1?.state)) &&
    failReason !== "Recovery restart current stage";

  const roundTerminal = Boolean(round1?.endedAt && TERMINAL_ROUND_STATES.includes(String(round1.state)));

  const prematureFail =
    failReason === "Recovery restart current stage" &&
    progressSamples.some(
      (s) =>
        ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(String(s.progressState)) &&
        Number(s.elapsedMs ?? 0) < Number(s.selectionBudgetMs ?? 1_200_000) * 0.5,
    );

  const verdict =
    roundTerminal &&
    zombieCount === 0 &&
    !prematureFail &&
    !prematureRestartDetected &&
    fs.existsSync(path.join(artifactRoot, "round-summary.json"))
      ? "PASS"
      : "FAIL";

  const result = {
    validationId: VALIDATION_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    sessionId,
    config: {
      mode: "PAPER",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      totalRounds: 1,
      aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
    },
    preflight: { canStart: preflight.canStart, overallVerdict: preflight.overallVerdict },
    job: finalJob
      ? {
          id: finalJob.id,
          status: finalJob.status,
          completedRounds: finalJob.completedRounds,
          failedRounds: finalJob.failedRounds,
          lastError: finalJob.lastError,
        }
      : null,
    round: round1
      ? {
          roundNo: round1.roundNo,
          runId: round1.id,
          state: round1.state,
          symbol: round1.symbol,
          result: round1.result,
          failReason: round1.failReason,
          startedAt: round1.startedAt,
          endedAt: round1.endedAt,
          durationMs:
            round1.startedAt && round1.endedAt
              ? new Date(round1.endedAt).getTime() - new Date(round1.startedAt).getTime()
              : null,
        }
      : null,
    recovery: {
      restartOccurred,
      prematureRestartDetected: prematureRestartDetected || prematureFail,
      recoverySnapshots,
      recoveryTimeline: recoveryTimeline.slice(0, 30),
      artifactRecoveryDecisions: recoveryDecisions?.records ?? [],
      artifactRecoveryTelemetry: recoveryTelemetryArtifact?.records ?? [],
    },
    progressSamples,
    timeline,
    selectionBudget: {
      configuredMs: runtimeFinal?.selectionBudgetMs ?? null,
      elapsedMs: runtimeFinal?.elapsedMs ?? null,
      lastProgressAt: runtimeFinal?.lastProgressAt ?? null,
      heartbeatAt: runtimeFinal?.heartbeatAt ?? null,
    },
    executionReached,
    legitimateZeroTrade,
    artifacts: {
      root: artifactRoot,
      roundSummaryExists: fs.existsSync(path.join(artifactRoot, "round-summary.json")),
      recoveryDecisionsExists: fs.existsSync(path.join(artifactRoot, "recovery-decisions.json")),
      aiProgressExists: fs.existsSync(path.join(artifactRoot, "ai-progress.json")),
      exportKind: roundSummary?.exportKind ?? null,
      failReason: roundSummary?.failReason ?? null,
    },
    consistency: {
      zombieCount,
      roundTerminal,
      dbFailReason: failReason,
      artifactFailReason: roundSummary?.failReason ?? null,
      aiInvoked: aiProgress?.total ?? null,
    },
    verdict,
    failReasons: [
      ...(prematureFail ? ["PREMATURE_RECOVERY_RESTART_DURING_HEALTHY_PROGRESS"] : []),
      ...(prematureRestartDetected ? ["PREMATURE_RESTART_IN_TELEMETRY"] : []),
      ...(zombieCount > 0 ? [`ZOMBIE_RUNS:${zombieCount}`] : []),
      ...(!roundTerminal ? ["ROUND_NOT_TERMINAL"] : []),
      ...(!fs.existsSync(path.join(artifactRoot, "round-summary.json")) ? ["MISSING_ROUND_SUMMARY"] : []),
    ],
  };

  writeJson(path.join(process.cwd(), "kripto-single-round-recovery-validation.json"), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ validationId: VALIDATION_ID, ok: false, error: (e as Error).message }, null, 2));
  process.exit(1);
});
