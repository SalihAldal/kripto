import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const jobId = process.argv[2];

async function main() {
  const { triggerSchedulerRecovery, ensureAutoRoundRecovery } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { prisma } = await import("@/src/server/db/prisma");

  const target =
    jobId ??
    (
      await prisma.autoRoundJob.findFirst({
        where: { status: "RUNNING" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      })
    )?.id;

  if (!target) {
    console.log(JSON.stringify({ ok: false, reason: "No RUNNING job" }));
    await prisma.$disconnect();
    process.exit(1);
  }

  const recovery = await triggerSchedulerRecovery({ jobId: target, force: true });
  const boot = await ensureAutoRoundRecovery();

  console.log(
    JSON.stringify(
      {
        ok: true,
        jobId: target,
        recovery,
        recoveredLoops: boot.recoveredLoops,
        runningJobs: boot.runningJobs,
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
