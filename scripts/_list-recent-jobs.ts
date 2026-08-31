import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const running = await p.autoRoundJob.findMany({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  const jobs = await p.autoRoundJob.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
    include: { rounds: { orderBy: { roundNo: "asc" }, take: 3 } },
  });
  console.log("RUNNING:", JSON.stringify(running, null, 2));
  console.log(
    JSON.stringify(
      jobs.map((j) => ({
        id: j.id,
        status: j.status,
        totalRounds: j.totalRounds,
        completedRounds: j.completedRounds,
        failedRounds: j.failedRounds,
        startedAt: j.startedAt,
        activeState: j.activeState,
        lastError: j.lastError,
        roundCount: j.rounds.length,
      })),
      null,
      2,
    ),
  );
  await p.$disconnect();
}

main();
