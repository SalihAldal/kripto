import { prisma } from "../src/server/db/prisma";

const jobId = process.argv[2] ?? "cmtd396jg0009un7c8im4dggo";

async function main() {
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    select: { status: true, currentRound: true, totalRounds: true, updatedAt: true },
  });
  const runs = await prisma.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "asc" },
    select: { roundNo: true, state: true, failReason: true, endedAt: true, symbol: true },
  });
  console.log(JSON.stringify({ job, runs }, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
