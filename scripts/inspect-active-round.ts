import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const job = await prisma.autoRoundJob.findFirst({
    where: { activeState: { notIn: ["bekliyor", "tamamlandi", "durduruldu"] } },
    orderBy: { startedAt: "desc" },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) {
    console.log(JSON.stringify({ ok: true, message: "No active job" }, null, 2));
    return;
  }
  const now = Date.now();
  const started = job.startedAt?.getTime() ?? now;
  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        activeState: job.activeState,
        status: job.status,
        totalRounds: job.totalRounds,
        completedRounds: job.completedRounds,
        failedRounds: job.failedRounds,
        stopRequested: job.stopRequested,
        lastError: job.lastError,
        startedAt: job.startedAt,
        elapsedMin: Math.round((now - started) / 60000),
        metadataRuntime: (job.metadata as Record<string, unknown> | null)?.runtime ?? null,
        recentSystemLogs: await prisma.systemLog.findMany({
          where: {
            OR: [
              { message: { contains: "cmsfxr8" } },
              { context: { path: ["runId"], equals: job.rounds[0]?.id } },
              { context: { path: ["transactionId"], equals: job.id } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: 15,
          select: { createdAt: true, level: true, source: true, message: true },
        }).catch(() => []),
        rounds: job.rounds.map((r) => ({
          id: r.id,
          roundNo: r.roundNo,
          state: r.state,
          symbol: r.symbol,
          failReason: r.failReason,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          elapsedMin: Math.round((now - r.startedAt.getTime()) / 60000),
          runtime: (r.metadata as Record<string, unknown> | null)?.runtime ?? null,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
