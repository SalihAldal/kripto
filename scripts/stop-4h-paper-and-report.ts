/**
 * Gracefully stop running paper job and build partial/full baseline report.
 */
import path from "node:path";
import fs from "node:fs";
import { loadEnvFile, writeJson, appendCheckpoint } from "./paper-campaign-runner-core";

loadEnvFile();

const campaignId =
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
  "paper-4h-2026-09-07T19-59-48-598Z";
const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", campaignId);

async function main() {
  const checkpointLines = fs.existsSync(path.join(artifactRoot, "checkpoints.jsonl"))
    ? fs.readFileSync(path.join(artifactRoot, "checkpoints.jsonl"), "utf8").trim().split("\n")
    : [];
  const jobStart = checkpointLines
    .map((l) => JSON.parse(l) as { type?: string; jobId?: string })
    .find((r) => r.type === "JOB_START");
  const jobId = jobStart?.jobId;
  if (!jobId) throw new Error("jobId not found in checkpoints");

  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { stopAutoRoundJob, getAutoRoundStatus } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  appendCheckpoint(artifactRoot, { type: "STOP_REQUESTED", reason: "manual_early_stop", jobId });

  try {
    await stopAutoRoundJob(user.id);
  } catch (error) {
    appendCheckpoint(artifactRoot, {
      type: "STOP_ERROR",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  await new Promise((r) => setTimeout(r, 5000));

  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  const { ensurePaperAccountInitialized } = await import("@/src/server/simulation/paper-trading.service");
  await ensurePaperAccountInitialized(user.id);
  const paperCashAfter = await (await import("@/src/server/simulation/paper-trading.service")).readPaperCashBalances(user.id);
  const accountBefore = JSON.parse(
    fs.readFileSync(path.join(artifactRoot, "account-snapshot-before.json"), "utf8"),
  ) as { paperCashBefore?: Record<string, number> };
  const frozen = JSON.parse(fs.readFileSync(path.join(artifactRoot, "frozen-config.json"), "utf8"));

  const campaignCmpId = `cmp:${jobId}`;
  const closed = await prisma.paperTrade.findMany({
    where: {
      userId: user.id,
      status: "CLOSED",
      OR: [{ campaignId }, { campaignId: campaignCmpId }],
    },
  });
  const openPos = await prisma.position.count({ where: { userId: user.id, status: "OPEN" } });
  const endedAtMs = Date.now();
  const jobStartedAt = job?.startedAt?.toISOString() ?? new Date(endedAtMs).toISOString();

  const snapshot = {
    campaignId,
    jobId,
    wallClockStartedAt: checkpointLines[0] ? JSON.parse(checkpointLines[0]).at : jobStartedAt,
    jobStartedAt,
    endedAt: new Date(endedAtMs).toISOString(),
    plannedDurationMs: frozen.DURATION_MS,
    actualJobDurationMs: endedAtMs - new Date(jobStartedAt).getTime(),
    completedFullDuration: false,
    gracefulStopRequested: true,
    stopReason: "manual_early_stop",
    reachedTerminal: job?.status !== "RUNNING",
    roundsCompleted: job?.rounds?.filter((r) => r.endedAt != null).length ?? 0,
    roundsRecorded: job?.rounds?.length ?? 0,
    tradeCount: closed.length,
    openPositionCount: openPos,
    realizedPnl: closed.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0),
    unrealizedPnl: 0,
    paperCashBefore: accountBefore.paperCashBefore,
    paperCashAfter,
    finalJobStatus: job?.status ?? null,
    artifactRoot,
    liveTradingEnabled: "false",
    executionMode: "paper",
    earlyStop: true,
  };

  writeJson(path.join(artifactRoot, "final-snapshot.json"), snapshot);
  appendCheckpoint(artifactRoot, { type: "FINAL", earlyStop: true, jobStatus: job?.status });

  const { build4hExtendedPaperBaselineReport } = await import("./build-4h-extended-paper-baseline-report");
  const report = await build4hExtendedPaperBaselineReport({ campaignId });

  await prisma.$disconnect();
  console.log(JSON.stringify({ stopped: true, campaignId, jobId, report: report.machineResult }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
