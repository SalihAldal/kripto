/**
 * Reconcile a crashed/orphan PAPER auto-round job without deleting logs or trades.
 * Usage: npx tsx scripts/reconcile-failed-paper-job.ts --jobId=<id> [--reason=FAILED_RUNNER_CRASH]
 */
import { loadEnvFile } from "./paper-campaign-runner-core";

loadEnvFile();

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...rest] = a.slice(2).split("=");
      return [k, rest.join("=") || "true"];
    }),
);

const jobId = String(args.jobId ?? "");
const reconcileReason = String(args.reason ?? "FAILED_RUNNER_CRASH");

if (!jobId) {
  console.error("Missing --jobId");
  process.exit(1);
}

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { user } = await getRuntimeExecutionContext();

  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "desc" }, take: 5 } },
  });
  if (!job) {
    console.error(JSON.stringify({ ok: false, error: "JOB_NOT_FOUND", jobId }));
    process.exit(2);
  }

  const openPositions = await prisma.position.count({ where: { userId: job.userId, status: "OPEN" } });
  const openOrders = await prisma.tradeOrder.count({
    where: { userId: job.userId, status: { in: ["NEW", "PARTIALLY_FILLED"] } },
  });
  if (job.userId !== user.id || openPositions > 0 || openOrders > 0) {
    throw new Error("RECONCILIATION_BLOCKED: wrong runtime user or unsettled exposure; recover monitors first");
  }
  if (job.status === "RUNNING" && Date.now() - job.updatedAt.getTime() < 120_000) {
    throw new Error("RECONCILIATION_BLOCKED: job recently updated; verify runner ownership before stopping");
  }
  const openRounds = job.rounds.filter((r) => !r.endedAt);

  const snapshot = {
    jobId: job.id,
    status: job.status,
    stopRequested: job.stopRequested,
    userId: job.userId,
    openPositions,
    openOrders,
    openRoundCount: openRounds.length,
    lastRound: job.rounds[0]?.roundNo ?? 0,
  };
  console.log(JSON.stringify({ phase: "BEFORE", snapshot }, null, 2));

  let stopResult: unknown = null;
  if (job.status === "RUNNING") {
    stopResult = await stopAutoRoundJob(user.id);
    const refreshed = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
    if (refreshed?.status === "RUNNING") {
      await prisma.autoRoundJob.update({
        where: { id: jobId },
        data: {
          status: "STOPPED",
          stopRequested: true,
          finishedAt: new Date(),
          lastError: reconcileReason,
          metadata: {
            ...((refreshed.metadata as Record<string, unknown> | null) ?? {}),
            reconcileReason,
            reconciledAt: new Date().toISOString(),
            technicalFailure: true,
            excludeFromCampaignPerformance: true,
          },
        },
      });
    } else if (refreshed) {
      await prisma.autoRoundJob.update({
        where: { id: jobId },
        data: {
          lastError: reconcileReason,
          metadata: {
            ...((refreshed.metadata as Record<string, unknown> | null) ?? {}),
            reconcileReason,
            reconciledAt: new Date().toISOString(),
            technicalFailure: true,
            excludeFromCampaignPerformance: true,
          },
        },
      });
    }
  } else {
    await prisma.autoRoundJob.update({
      where: { id: jobId },
      data: {
        lastError: reconcileReason,
        metadata: {
          ...((job.metadata as Record<string, unknown> | null) ?? {}),
          reconcileReason,
          reconciledAt: new Date().toISOString(),
          technicalFailure: true,
          excludeFromCampaignPerformance: true,
        },
      },
    });
  }

  const after = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, stopRequested: true, finishedAt: true, lastError: true, metadata: true },
  });
  const runningJobs = await prisma.autoRoundJob.count({ where: { userId: job.userId, status: "RUNNING" } });

  console.log(
    JSON.stringify(
      {
        ok: true,
        phase: "AFTER",
        stopResult,
        job: after,
        runningJobsRemaining: runningJobs,
        openPositionsAfter: await prisma.position.count({ where: { userId: job.userId, status: "OPEN" } }),
        openOrdersAfter: await prisma.tradeOrder.count({
          where: { userId: job.userId, status: { in: ["NEW", "PARTIALLY_FILLED"] } },
        }),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
