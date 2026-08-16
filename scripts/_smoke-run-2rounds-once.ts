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

const SMOKE_RUN_ID = `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

function readJson(filePath: string) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function analyzeRoundArtifacts(sessionId: string, roundId: string) {
  const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);
  const summary = readJson(path.join(root, "round-summary.json"));
  const aiProgress = readJson(path.join(root, "ai-progress.json"));
  const watchdog = readJson(path.join(root, "round-watchdog.json"));
  const tx = readJson(path.join(root, "transaction-duration.json"));
  const lifecycle = readJson(path.join(root, "candidate-lifecycle.json"));
  const errors = readJson(path.join(root, "errors.json"));
  const pnl = readJson(path.join(root, "pnl-ledger.json"));
  const exit = readJson(path.join(root, "exit-trace.json"));
  const txRecords = Array.isArray(tx?.records) ? tx.records : [];
  const aiCandidates = Array.isArray(aiProgress?.candidates) ? aiProgress.candidates : [];
  const lifecycleRows = Array.isArray(lifecycle) ? lifecycle : lifecycle?.records ?? [];
  return {
    artifactRoot: root,
    exists: fs.existsSync(root),
    summary,
    aiProgress,
    watchdog,
    txTimeouts: txRecords.filter((r: { classification?: string }) => r.classification === "TIMEOUT").length,
    txSlow: txRecords.filter((r: { classification?: string }) => r.classification === "SLOW").length,
    txCount: txRecords.length,
    aiFailed: aiCandidates.filter((r: { status?: string }) => r.status === "AI_FAILED").length,
    aiTimeout: aiCandidates.filter((r: { status?: string }) => r.status === "AI_TIMEOUT").length,
    consensusFailed: aiCandidates.filter((r: { status?: string }) => r.status === "CONSENSUS_FAILED").length,
    consensusTimeout: aiCandidates.filter((r: { status?: string }) => r.status === "CONSENSUS_TIMEOUT").length,
    aiSuccess: aiCandidates.filter((r: { status?: string }) => r.status === "COMPLETED").length,
    watchdogDecision: watchdog?.decision,
    watchdogAction: watchdog?.action,
    lifecycleCount: lifecycleRows.length,
    errors,
    pnl,
    exit,
  };
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus } = await import("@/src/server/execution/auto-round-engine.service");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${SMOKE_RUN_ID}-preflight`,
  });

  if (!preflight.canStart) {
    console.log(
      JSON.stringify(
        {
          smokeRunId: SMOKE_RUN_ID,
          phase: "blocked",
          preflight,
        },
        null,
        2,
      ),
    );
    await prisma.$disconnect();
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 2,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 900,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  if (!started.started || !started.jobId) {
    console.log(JSON.stringify({ smokeRunId: SMOKE_RUN_ID, phase: "start_failed", started, preflight }, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const deadline = Date.now() + 90 * 60_000;
  let lastStatus: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;
  while (Date.now() < deadline) {
    lastStatus = await getAutoRoundStatus(user.id);
    const jobRow = await prisma.autoRoundJob.findUnique({ where: { id: sessionId } });
    if (jobRow && jobRow.status !== "RUNNING") break;
    await sleep(15_000);
  }

  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  const round1 = finalJob?.rounds.find((r) => r.roundNo === 1);
  const round2 = finalJob?.rounds.find((r) => r.roundNo === 2);
  const r1 = round1 ? await analyzeRoundArtifacts(sessionId, String(round1.roundNo)) : null;
  const r2 = round2 ? await analyzeRoundArtifacts(sessionId, String(round2.roundNo)) : null;
  const zombieAfter = await prisma.autoRoundRun.count({
    where: {
      jobId: sessionId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const terminalStates = ["tur_tamamlandi", "tur_basarisiz", "sure_doldu", "satis_gerceklesti", "zarar_durdur_calisti"];
  const readinessBlockers: string[] = [];
  if (!finalJob || finalJob.status === "RUNNING") readinessBlockers.push("JOB_STILL_RUNNING");
  if (zombieAfter > 0) readinessBlockers.push(`ZOMBIE_RUNS:${zombieAfter}`);
  if (!round1 || !round1.endedAt || !terminalStates.includes(round1.state)) readinessBlockers.push("ROUND1_NOT_TERMINAL");
  if (!round2 || !round2.endedAt || !terminalStates.includes(round2.state)) readinessBlockers.push("ROUND2_NOT_TERMINAL");
  for (const [label, data] of [
    ["R1", r1],
    ["R2", r2],
  ] as const) {
    if (!data?.exists) readinessBlockers.push(`${label}_ARTIFACTS_MISSING`);
    if ((data?.txTimeouts ?? 0) > 0) readinessBlockers.push(`${label}_DB_TX_TIMEOUT`);
    if ((data?.aiTimeout ?? 0) > 0) readinessBlockers.push(`${label}_AI_TIMEOUT`);
    if ((data?.consensusTimeout ?? 0) > 0) readinessBlockers.push(`${label}_CONSENSUS_TIMEOUT`);
    if (data?.watchdogDecision === "FAIL_ROUND" || data?.watchdogDecision === "ESCALATE") {
      readinessBlockers.push(`${label}_WATCHDOG_${data.watchdogDecision}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        smokeRunId: SMOKE_RUN_ID,
        sessionId,
        preflight,
        start: { started: started.started, jobId: sessionId, totalRounds: 2 },
        finalJob: finalJob
          ? {
              id: finalJob.id,
              status: finalJob.status,
              activeState: finalJob.activeState,
              completedRounds: finalJob.completedRounds,
              failedRounds: finalJob.failedRounds,
              lastError: finalJob.lastError,
              finishedAt: finalJob.finishedAt,
            }
          : null,
        rounds: finalJob?.rounds.map((r) => ({
          roundNo: r.roundNo,
          id: r.id,
          state: r.state,
          symbol: r.symbol,
          result: r.result,
          failReason: r.failReason,
          netPnl: r.netPnl,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
        })),
        round1Analysis: r1,
        round2Analysis: r2,
        readiness: readinessBlockers.length === 0 ? "READY_FOR_30_ROUNDS" : "NOT_READY",
        readinessBlockers,
        lastStatus,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(JSON.stringify({ smokeRunId: SMOKE_RUN_ID, ok: false, error: (e as Error).message, stack: (e as Error).stack }, null, 2));
  process.exit(1);
});
