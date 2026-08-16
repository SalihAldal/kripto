import { prisma } from "@/src/server/db/prisma";

async function main() {
  const running = await prisma.autoRoundJob.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
    include: { rounds: { orderBy: { roundNo: "desc" }, take: 1 } },
  });
  if (running) {
    console.log(
      JSON.stringify(
        {
          running: true,
          jobId: running.id,
          totalRounds: running.totalRounds,
          activeState: running.activeState,
          completedRounds: running.completedRounds,
          failedRounds: running.failedRounds,
          currentRound: running.rounds[0]?.roundNo ?? running.completedRounds + running.failedRounds + 1,
          roundState: running.rounds[0]?.state,
          symbol: running.rounds[0]?.symbol,
          startedAt: running.startedAt,
        },
        null,
        2,
      ),
    );
    return;
  }
  const last = await prisma.autoRoundJob.findFirst({
    orderBy: { startedAt: "desc" },
    include: { rounds: { orderBy: { roundNo: "desc" }, take: 1 } },
  });
  console.log(
    JSON.stringify(
      {
        running: false,
        lastJob: last
          ? {
              jobId: last.id,
              status: last.status,
              totalRounds: last.totalRounds,
              completedRounds: last.completedRounds,
              failedRounds: last.failedRounds,
              lastRound: last.rounds[0]?.roundNo,
              symbol: last.rounds[0]?.symbol,
              finishedAt: last.finishedAt,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
