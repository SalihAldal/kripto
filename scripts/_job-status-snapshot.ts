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
  const j = await prisma.autoRoundJob.findUnique({
    where: { id: "cmtc4c2ds0009un70ir6hlcqm" },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  const failReasons: Record<string, number> = {};
  for (const r of j?.rounds ?? []) {
    const key = r.failReason ? String(r.failReason).slice(0, 80) : r.state;
    failReasons[key] = (failReasons[key] ?? 0) + 1;
  }
  console.log(
    JSON.stringify(
      {
        status: j?.status,
        currentRound: j?.currentRound,
        completedRounds: j?.completedRounds,
        failedRounds: j?.failedRounds,
        totalRounds: j?.totalRounds,
        lastError: j?.lastError,
        activeState: j?.activeState,
        startedAt: j?.startedAt,
        finishedAt: j?.finishedAt,
        roundCount: j?.rounds.length,
        failReasonTop: Object.entries(failReasons)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}
main();
