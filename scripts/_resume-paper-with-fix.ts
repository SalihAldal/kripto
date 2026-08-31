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
  const { triggerSchedulerRecovery } = await import("@/src/server/execution/auto-round-engine.service");
  const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.log(JSON.stringify({ ok: false, reason: "job_not_found" }));
    await prisma.$disconnect();
    process.exit(1);
  }
  if (job.status === "FAILED" || job.activeState === "tur_basarisiz") {
    const nextRound = Math.max(job.currentRound, job.failedRounds + 1);
    await prisma.autoRoundJob.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        activeState: "tariyor",
        lastError: null,
        finishedAt: null,
        currentRound: nextRound,
        activeRunId: null,
        metadata: { ...((job.metadata as Record<string, unknown>) ?? {}), activeRound: null } as never,
      },
    });
  }
  const recovery = await triggerSchedulerRecovery({ jobId, force: true });
  const after = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
  console.log(JSON.stringify({ ok: true, recovery, job: after }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
