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
  const { stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const stop = await stopAutoRoundJob();
  console.log(JSON.stringify({ phase: "stop", stop }, null, 2));

  for (let i = 0; i < 12; i += 1) {
    const running = await prisma.autoRoundJob.findFirst({
      where: { status: "RUNNING" },
      select: { id: true, status: true, stopRequested: true },
    });
    if (!running) {
      console.log(JSON.stringify({ phase: "idle", ok: true }));
      await prisma.$disconnect();
      return;
    }
    if (running.stopRequested) {
      await prisma.autoRoundJob.update({
        where: { id: running.id },
        data: { status: "STOPPED", activeState: "bekliyor", stopRequested: false },
      });
      console.log(JSON.stringify({ phase: "force_stopped", jobId: running.id }));
      await prisma.$disconnect();
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const stuck = await prisma.autoRoundJob.findFirst({
    where: { status: "RUNNING" },
    select: { id: true },
  });
  console.log(JSON.stringify({ phase: "still_running", jobId: stuck?.id }));
  await prisma.$disconnect();
  process.exit(1);
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
});
