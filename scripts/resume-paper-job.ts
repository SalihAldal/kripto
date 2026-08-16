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
  const prevJobId = process.argv[2] ?? "cmstkgy6j0022unm8lannq6cg";
  const { prisma } = await import("@/src/server/db/prisma");
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");

  const prev = await prisma.autoRoundJob.findUnique({ where: { id: prevJobId } });
  if (!prev) {
    console.log(JSON.stringify({ ok: false, reason: "Previous job not found" }));
    await prisma.$disconnect();
    process.exit(1);
  }

  const running = await prisma.autoRoundJob.findFirst({ where: { status: "RUNNING" } });
  if (running) {
    console.log(JSON.stringify({ ok: false, reason: "Another RUNNING job exists", jobId: running.id }));
    await prisma.$disconnect();
    process.exit(1);
  }

  const remaining = Math.max(1, prev.totalRounds - prev.completedRounds - prev.failedRounds);
  const { user } = await getRuntimeExecutionContext();

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: remaining,
    budgetPerTrade: prev.budgetPerTrade,
    targetProfitPct: prev.targetProfitPct,
    stopLossPct: prev.stopLossPct,
    maxWaitSec: prev.maxWaitSec,
    coinSelectionMode: prev.coinSelectionMode as "scanner_best",
    aiMode: prev.aiMode as "learning",
    allowRepeatCoin: prev.allowRepeatCoin,
    mode: prev.mode as "auto",
  });

  console.log(JSON.stringify({ ok: true, remainingRounds: remaining, previousJobId: prevJobId, started }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
});
