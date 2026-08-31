import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const jobId =
    process.argv[2] ??
    (
      await p.autoRoundJob.findFirst({
        where: { status: "RUNNING" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      })
    )?.id;
  if (!jobId) {
    console.log(JSON.stringify({ ok: false, reason: "No RUNNING job and no jobId argument" }));
    await p.$disconnect();
    process.exit(1);
  }
  const job = await p.autoRoundJob.findUnique({
    where: { id: jobId },
    select: {
      status: true,
      totalRounds: true,
      currentRound: true,
      completedRounds: true,
      failedRounds: true,
      lastError: true,
      activeState: true,
      metadata: true,
      updatedAt: true,
    },
  });
  const rounds = await p.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "asc" },
    select: {
      id: true,
      roundNo: true,
      state: true,
      endedAt: true,
      failReason: true,
      result: true,
      startedAt: true,
    },
  });
  const completed = rounds.filter((r) => r.endedAt).length;
  const failed = rounds.filter((r) => r.state === "tur_basarisiz" || Boolean(r.failReason));
  const active = rounds.filter((r) => !r.endedAt);
  console.log(
    JSON.stringify(
      {
        job,
        roundCount: rounds.length,
        completed,
        failedCount: failed.length,
        activeRoundNos: active.map((r) => r.roundNo),
        failedRounds: failed.map((r) => ({ roundNo: r.roundNo, state: r.state, error: r.failReason })),
        lastRounds: rounds.slice(-8),
      },
      null,
      2,
    ),
  );
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
