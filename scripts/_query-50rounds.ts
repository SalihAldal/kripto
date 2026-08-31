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
  const { prisma } = await import("@/src/server/db/prisma");
  const rounds = await prisma.autoRoundRun.findMany({
    where: { jobId: "cmtc4c2ds0009un70ir6hlcqm" },
    orderBy: { roundNo: "asc" },
    select: {
      roundNo: true,
      state: true,
      symbol: true,
      failReason: true,
      startedAt: true,
      endedAt: true,
      metadata: true,
    },
  });
  console.log(JSON.stringify({ roundCount: rounds.length, rounds }, null, 2));
  await prisma.$disconnect();
}
main();
