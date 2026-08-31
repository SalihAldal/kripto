import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const jobId = process.argv[2] ?? "cmt4zxkbm001gun8ghz4qsb0w";
  const job = await p.autoRoundJob.findUnique({ where: { id: jobId } });
  const rounds = await p.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "asc" },
    select: {
      roundNo: true,
      id: true,
      state: true,
      symbol: true,
      failReason: true,
      startedAt: true,
      endedAt: true,
    },
  });
  console.log(JSON.stringify({ job, roundCount: rounds.length, rounds }, null, 2));
  await p.$disconnect();
}

main();
