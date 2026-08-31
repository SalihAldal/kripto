/**
 * Resume a FAILED auto-round job and respawn scheduler.
 * Usage: node -r ./scripts/load-dotenv.cjs node_modules/tsx/dist/cli.mjs scripts/resume-failed-paper-job.ts <jobId>
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

const jobId = process.argv[2] ?? "cmt6clvtb001eun30xoj58u0d";

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const { triggerSchedulerRecovery, ensureAutoRoundRecovery } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );

  const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.log(JSON.stringify({ ok: false, reason: "job_not_found" }));
    await prisma.$disconnect();
    process.exit(1);
  }

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
      metadata: {
        ...((job.metadata as Record<string, unknown>) ?? {}),
        activeRound: null,
        consecutiveFilterRejections: 0,
      } as never,
    },
  });

  const recovery = await triggerSchedulerRecovery({ jobId, force: true });
  const boot = await ensureAutoRoundRecovery();

  const after = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    select: { status: true, currentRound: true, failedRounds: true, lastError: true },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId,
        resumedFromRound: nextRound,
        recovery,
        boot,
        after,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
});
