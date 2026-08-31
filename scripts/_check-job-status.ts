import fs from "node:fs";
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

async function main() {
  const jobId = process.argv[2] ?? "cmtdla29j0009unhogsjcmoea";
  const { prisma } = await import("@/src/server/db/prisma");
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    select: {
      status: true,
      stopRequested: true,
      currentRound: true,
      completedRounds: true,
      failedRounds: true,
      totalRounds: true,
    },
  });
  console.log(JSON.stringify(job, null, 2));
  await prisma.$disconnect();
}

main();
