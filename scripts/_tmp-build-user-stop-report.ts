import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { buildMicroBottleneckForensic } from "@/src/server/forensics/micro-bottleneck-forensic.service";

async function main() {
  const jobId = "cmtgcfu8p02rpunjg2qvqzjlg";
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) throw new Error("JOB_NOT_FOUND");

  const rounds = job.rounds.map((r) => ({
    roundNo: r.roundNo,
    state: r.state,
    result: r.result,
    failReason: r.failReason,
    startedAt: r.startedAt?.toISOString?.() ?? null,
    endedAt: r.endedAt?.toISOString?.() ?? null,
    grossPnl: Number(r.grossPnl ?? 0),
    fees: Number(r.fees ?? 0),
    netPnl: Number(r.netPnl ?? 0),
    tradeCount: Number(r.tradeCount ?? 0),
  }));
  const endedRounds = rounds.filter((r) => r.endedAt);
  const totalTrades = rounds.reduce((a, r) => a + r.tradeCount, 0);
  const netPnl = rounds.reduce((a, r) => a + r.netPnl, 0);
  const fees = rounds.reduce((a, r) => a + r.fees, 0);

  const startAt = job.startedAt ?? job.createdAt ?? new Date(Date.now() - 3 * 60 * 60 * 1000);
  const endAt = job.completedAt ?? job.updatedAt ?? new Date();
  const micro = await buildMicroBottleneckForensic({
    startedAt: startAt,
    completedAt: endAt,
    moverTarget: 6,
  });

  const out = {
    jobId,
    userTerminated: true,
    jobStatus: job.status,
    startedAt: startAt.toISOString(),
    endedAt: endAt.toISOString(),
    totalRoundsPlanned: Number(job.totalRounds ?? 10),
    roundsFinished: endedRounds.length,
    roundsInDb: rounds.length,
    paperTrades: totalTrades,
    netPnl,
    fees,
    rounds,
    microForensic: micro,
  };

  const outPath = path.join(process.cwd(), "artifacts", "forensics", "micro-bottleneck-user-stop-summary.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(outPath);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error((error as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
