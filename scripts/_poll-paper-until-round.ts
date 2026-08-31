/**
 * Poll paper job until target round or failure.
 * Usage: node -r ./scripts/load-dotenv.cjs node_modules/tsx/dist/cli.mjs scripts/_poll-paper-until-round.ts <jobId> <targetRound>
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const jobId = process.argv[2] ?? "cmt6clvtb001eun30xoj58u0d";
const targetRound = Number(process.argv[3] ?? 20);
const intervalMs = Number(process.env.POLL_INTERVAL_MS ?? 90_000);
const logPath = path.join(process.cwd(), "artifacts", "monitor", "poll-" + jobId + ".jsonl");

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function append(entry: unknown) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");
}

async function snapshot(p: PrismaClient) {
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
  const meta = (job?.metadata ?? {}) as Record<string, unknown>;
  const activeRound = meta.activeRound as Record<string, unknown> | undefined;
  const rounds = await p.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "desc" },
    take: 5,
    select: { roundNo: true, state: true, endedAt: true, failReason: true },
  });
  const completed = await p.autoRoundRun.count({ where: { jobId, endedAt: { not: null } } });
  return { job, activeRound, completed, recentRounds: rounds };
}

async function main() {
  const p = new PrismaClient();
  console.log(
    "Polling job " + jobId + " until round " + targetRound + " (interval " + intervalMs + "ms)",
  );

  while (true) {
    const snap = await snapshot(p);
    const entry = {
      at: new Date().toISOString(),
      status: snap.job?.status,
      currentRound: snap.job?.currentRound,
      completedRounds: snap.job?.completedRounds,
      failedRounds: snap.job?.failedRounds,
      lastError: snap.job?.lastError,
      activeState: snap.job?.activeState,
      step: snap.activeRound?.step,
      message: snap.activeRound?.message,
      heartbeatAt: snap.activeRound?.heartbeatAt,
      dbCompleted: snap.completed,
      recentRounds: snap.recentRounds,
    };
    append(entry);
    console.log(JSON.stringify(entry));

    if (snap.job?.status === "FAILED" || snap.job?.status === "STOPPED") {
      console.error("JOB_TERMINATED", snap.job?.status, snap.job?.lastError);
      break;
    }
    if (snap.job?.lastError) {
      console.warn("JOB_LAST_ERROR", snap.job.lastError);
    }
    const reached =
      (snap.job?.completedRounds ?? 0) >= targetRound ||
      (snap.job?.currentRound ?? 0) > targetRound ||
      snap.completed >= targetRound;
    if (reached && snap.job?.status !== "RUNNING") break;
    if ((snap.job?.completedRounds ?? 0) >= targetRound) break;
    if (snap.completed >= targetRound) break;

    await sleep(intervalMs);
  }

  await p["$disconnect"]();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
