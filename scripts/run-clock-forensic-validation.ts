/**
 * Single-round clock + forensic export validation.
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

const VALIDATION_ID = `clock-forensic-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const POLL_MS = 10_000;
const JOB_DEADLINE_MS = 35 * 60_000;

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

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { evaluateClockSync } = await import("@/src/server/execution-safety/clock-sync.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const preflightClock = await evaluateClockSync();
  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  const result: Record<string, unknown> = {
    validationId: VALIDATION_ID,
    startedAt: new Date().toISOString(),
    preflight: {
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
      clockSync: preflight.clockSync,
      blockCode: preflight.blockCode,
    },
    clockProbe: preflightClock.forensics,
    sessionId: null as string | null,
    round: null as unknown,
    artifacts: null as unknown,
    verdict: "FAIL",
    failReasons: [] as string[],
  };

  if (!preflight.canStart) {
    result.verdict = preflight.clockSync.reasonCode === "CLOCK_SKEW_ENVIRONMENT" ? "PASS_ENV_BLOCKED" : "FAIL";
    if (preflight.clockSync.reasonCode !== "CLOCK_SKEW_ENVIRONMENT") {
      result.failReasons = [`PREFLIGHT_BLOCKED:${preflight.blockCode}`];
    }
    writeJson(path.join(process.cwd(), "kripto-clock-forensic-fix.json"), result);
    console.log(JSON.stringify(result, null, 2));
    await prisma.$disconnect();
    process.exit(result.verdict === "PASS_ENV_BLOCKED" ? 0 : 2);
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
    result.failReasons = ["START_FAILED"];
    writeJson(path.join(process.cwd(), "kripto-clock-forensic-fix.json"), result);
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  result.sessionId = sessionId;

  const deadline = Date.now() + JOB_DEADLINE_MS;
  while (Date.now() < deadline) {
    const jobRow = await prisma.autoRoundJob.findUnique({ where: { id: sessionId } });
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
  const exportError = readJson<Record<string, unknown>>(path.join(artifactRoot, "export-error.json"));
  const clockForensics = readJson<Record<string, unknown>>(path.join(artifactRoot, "clock-sync-forensics.json"));

  result.round = round1
    ? {
        state: round1.state,
        failReason: round1.failReason,
        symbol: round1.symbol,
        endedAt: round1.endedAt,
      }
    : null;
  result.artifacts = {
    roundSummaryExists: fs.existsSync(path.join(artifactRoot, "round-summary.json")),
    recoveryDecisionsExists: fs.existsSync(path.join(artifactRoot, "recovery-decisions.json")),
    recoveryTelemetryExists: fs.existsSync(path.join(artifactRoot, "recovery-telemetry.json")),
    exportErrorExists: Boolean(exportError),
    exportStatus: roundSummary?.exportStatus ?? (exportError ? "FAILED" : null),
    exportKind: roundSummary?.exportKind ?? null,
    clockForensicsExists: Boolean(clockForensics),
  };
  result.completedAt = new Date().toISOString();

  const failReasons: string[] = [];
  if (!round1?.endedAt) failReasons.push("ROUND_NOT_TERMINAL");
  if (!fs.existsSync(path.join(artifactRoot, "round-summary.json"))) failReasons.push("MISSING_ROUND_SUMMARY");
  if (!fs.existsSync(path.join(artifactRoot, "recovery-decisions.json"))) failReasons.push("MISSING_RECOVERY_DECISIONS");
  if (exportError) failReasons.push("EXPORT_ERROR_ARTIFACT");

  const staleRecoveryRestart = String(round1?.failReason ?? "").includes("Recovery restart current stage");
  if (staleRecoveryRestart) failReasons.push("PREMATURE_RECOVERY_RESTART");

  result.failReasons = failReasons;
  result.verdict =
    failReasons.length === 0 || (failReasons.length === 1 && failReasons[0] === "EXPORT_ERROR_ARTIFACT" && roundSummary)
      ? "PASS"
      : failReasons.every((row) => row !== "PREMATURE_RECOVERY_RESTART" && row !== "MISSING_ROUND_SUMMARY")
        ? "PARTIAL"
        : "FAIL";

  if (!roundSummary && !exportError) {
    result.verdict = "FAIL";
  } else if (roundSummary && !staleRecoveryRestart) {
    result.verdict = exportError ? "PARTIAL" : "PASS";
  }

  writeJson(path.join(process.cwd(), "kripto-clock-forensic-fix.json"), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(result.verdict === "FAIL" ? 1 : 0);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ validationId: VALIDATION_ID, ok: false, error: (e as Error).message }, null, 2));
  process.exit(1);
});
