/**
 * Live paper session monitor — prints JSON snapshot for agent polling.
 */
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
  const running = await prisma.autoRoundJob.findMany({
    where: { status: "RUNNING" },
    include: { rounds: { orderBy: { roundNo: "desc" }, take: 1 } },
  });

  const zombies = await prisma.autoRoundRun.count({
    where: {
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const heartbeatAgeSec =
    running[0]?.metadata &&
    typeof running[0].metadata === "object" &&
    (running[0].metadata as Record<string, unknown>).activeRound &&
    typeof (running[0].metadata as Record<string, unknown>).activeRound === "object"
      ? Math.round(
          (Date.now() -
            new Date(
              String(
                ((running[0].metadata as Record<string, unknown>).activeRound as Record<string, unknown>)
                  .heartbeatAt,
              ),
            ).getTime()) /
            1000,
        )
      : null;

  const snapshot = {
    at: new Date().toISOString(),
    runningJobs: running.map((j) => ({
      id: j.id,
      currentRound: j.currentRound,
      totalRounds: j.totalRounds,
      completedRounds: j.completedRounds,
      failedRounds: j.failedRounds,
      stopRequested: j.stopRequested,
      lastError: j.lastError,
      activeState: j.activeState,
      latestRound: j.rounds[0]
        ? {
            roundNo: j.rounds[0].roundNo,
            state: j.rounds[0].state,
            symbol: j.rounds[0].symbol,
            failReason: j.rounds[0].failReason,
            startedAt: j.rounds[0].startedAt,
            endedAt: j.rounds[0].endedAt,
          }
        : null,
    })),
    zombieOpenRuns: zombies,
    heartbeatAgeSec,
    activeStep:
      running[0]?.metadata &&
      typeof running[0].metadata === "object" &&
      (running[0].metadata as Record<string, unknown>).activeRound
        ? ((running[0].metadata as Record<string, unknown>).activeRound as Record<string, unknown>).step
        : null,
  };

  console.log(JSON.stringify(snapshot, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
});
